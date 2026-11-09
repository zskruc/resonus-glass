package expo.modules.localhttp

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Separately scoped from casting. Its storage adapter never accepts a requested filesystem path. */
interface TransferStorage {
  fun create(name: String, mime: String, size: Long): TransferSink
  fun open(uri: String): TransferRead
}
interface TransferSink {
  val output: OutputStream
  fun commit(): String
  fun abort()
}
class TransferRead(val input: InputStream, val size: Long) : AutoCloseable { override fun close() = input.close() }
data class TransferFile(val key: String, val uri: String, val name: String, val mime: String, val bytes: Long)
private data class TransferProgress(val id: String, val name: String, val total: Long, val direction: String,
  @Volatile var received: Long = 0, @Volatile var state: String = "running", @Volatile var error: String? = null)

class TransferServer(private val storage: TransferStorage) {
  private val token = UUID.randomUUID().toString().replace("-", "") + UUID.randomUUID().toString().replace("-", "")
  private val lock = Any()
  private var socket: ServerSocket? = null
  private var pool: ThreadPoolExecutor? = null
  private var host = ""
  private val clients = ConcurrentHashMap.newKeySet<Socket>()
  private val progress = LinkedHashMap<String, TransferProgress>()
  private val uploaded = LinkedHashMap<String, TransferFile>()
  @Volatile private var published: Map<String, TransferFile> = emptyMap()
  @Volatile private var running = false

  fun start(address: String): String {
    synchronized(lock) {
      if (running) return origin()!!
      val bind = InetAddress.getByName(address)
      require(bind.isSiteLocalAddress || bind.isLoopbackAddress) { "A Wi-Fi address is required" }
      host = address
      val server = ServerSocket(0, 12, bind)
      socket = server
      pool = ThreadPoolExecutor(4, 4, 20, TimeUnit.SECONDS, ArrayBlockingQueue(8))
      running = true
      Thread({
        while (running) {
          val client = try { server.accept() } catch (_: Exception) { break }
          if (!running) { client.close(); break }
          if (!(client.inetAddress.isSiteLocalAddress || client.inetAddress.isLoopbackAddress)) { client.close(); continue }
          clients.add(client)
          try { pool?.execute { serve(client) } ?: client.close() } catch (_: Exception) { clients.remove(client); client.close() }
        }
      }, "resonus-wifi-transfer").apply { isDaemon = true }.start()
      return origin()!!
    }
  }
  fun stop() {
    synchronized(lock) {
      running = false
      try { socket?.close() } catch (_: Exception) { }
      socket = null
      clients.forEach { try { it.close() } catch (_: Exception) { } }; clients.clear()
      pool?.shutdownNow(); pool = null; published = emptyMap()
      progress.values.filter { it.state == "running" }.forEach { it.state = "cancelled" }
    }
  }
  fun matchesAddress(address: String?): Boolean = running && host == address
  fun origin(): String? = if (running) socket?.let { "http://$host:${it.localPort}/$token/" } else null
  fun setEntries(files: List<TransferFile>) {
    require(files.size <= 200) { "Select at most 200 files" }
    val next = LinkedHashMap<String, TransferFile>()
    for (f in files) {
      require(f.key.matches(Regex("[a-zA-Z0-9_-]{1,100}")) && f.key != "__proto__") { "Invalid file key" }
      require(f.uri.startsWith("content://") || f.uri.startsWith("file://")) { "Only selected local files may be shared" }
      require(f.bytes in 0..MAX_FILE_BYTES && safeName(f.name) != null) { "Invalid shared music file" }
      next[f.key] = f.copy(mime = audioMime(f.name) ?: "application/octet-stream")
    }
    published = next
  }
  fun statusJson(publicView: Boolean = false): String = synchronized(lock) {
    val transfers = progress.values.toList().joinToString(",") { p ->
      "{\"id\":${json(p.id)},\"name\":${json(p.name)},\"total\":${p.total},\"received\":${p.received},\"state\":${json(p.state)},\"direction\":${json(p.direction)}${p.error?.let { ",\"error\":${json(it)}" } ?: ""}}"
    }
    val files = (published.values + uploaded.values).distinctBy { it.key }.joinToString(",") { fileJson(it, false) }
    "{\"running\":$running,\"url\":${origin()?.let(::json) ?: "null"},\"maxFileBytes\":$MAX_FILE_BYTES,\"files\":[$files],\"transfers\":[$transfers],\"uploads\":[${if (publicView) "" else uploaded.values.joinToString(",") { fileJson(it, true) }}]}"
  }
  private fun fileJson(f: TransferFile, privateUri: Boolean): String = "{\"key\":${json(f.key)},\"id\":${json(f.key)},\"name\":${json(f.name)},\"mime\":${json(f.mime)},\"bytes\":${f.bytes}${if (privateUri) ",\"uri\":${json(f.uri)}" else ""}}"
  private fun note(id: String, name: String, total: Long, direction: String): TransferProgress = synchronized(lock) {
    require(!progress.containsKey(id)) { "Duplicate transfer ID" }
    while (progress.size >= 60) {
      val old = progress.entries.firstOrNull { it.value.state != "running" } ?: throw IllegalStateException("Transfer queue is full")
      progress.remove(old.key)
    }
    TransferProgress(id, name, total, direction).also { progress[id] = it }
  }
  private fun serve(client: Socket) {
    try {
      client.soTimeout = 20000
      BufferedInputStream(client.getInputStream(), 64 * 1024).use { input ->
        BufferedOutputStream(client.getOutputStream(), 64 * 1024).use { out -> respond(input, out) }
      }
    } catch (_: Exception) { } finally { clients.remove(client); try { client.close() } catch (_: Exception) { } }
  }
  private fun respond(input: InputStream, out: OutputStream) {
    val lines = readHead(input)?.split("\r\n") ?: return response(out, 431, "Header too large")
    val request = lines[0].split(' ')
    if (request.size != 3 || !request[1].startsWith('/')) return response(out, 400, "Bad request")
    val method = request[0]; val target = request[1]; val path = target.substringBefore('?')
    val headers = LinkedHashMap<String, String>()
    for (line in lines.drop(1).filter { it.isNotEmpty() }) {
      val sep = line.indexOf(':'); if (sep <= 0 || line[0].isWhitespace()) return response(out, 400, "Bad header")
      val key = line.take(sep).lowercase(Locale.ROOT); val value = line.drop(sep + 1).trim()
      if (headers.put(key, value) != null) return response(out, 400, "Duplicate header")
    }
    val expectedHost = "$host:${socket?.localPort ?: return}"
    if (headers["host"] != expectedHost) return response(out, 403, "Invalid host")
    val parts = path.split('/')
    if (parts.size < 3 || !MessageDigest.isEqual(parts[1].toByteArray(), token.toByteArray())) return response(out, 404, "Not found")
    val op = parts.drop(2).joinToString("/")
    if (method == "GET" && op == "") return response(out, 200, "OK", WEB_PAGE, "text/html; charset=utf-8")
    if (method == "GET" && op == "status") return response(out, 200, "OK", statusJson(true), "application/json; charset=utf-8")
    if ((method == "GET" || method == "HEAD") && op.startsWith("files/")) return download(op.removePrefix("files/"), method, out)
    if (method == "POST" && op == "upload") {
      if (headers["origin"] != "http://$expectedHost") return response(out, 403, "Invalid origin")
      if (headers.containsKey("transfer-encoding")) return response(out, 400, "A content length is required")
      val size = headers["content-length"]?.toLongOrNull() ?: return response(out, 411, "A content length is required")
      if (size !in 1..MAX_FILE_BYTES) return response(out, 413, "Music file exceeds 512 MiB")
      val query = try { parseQuery(target.substringAfter('?', "")) } catch (_: Exception) { return response(out, 400, "Invalid upload") }
      val name = safeName(query["name"]) ?: return response(out, 400, "Invalid music filename")
      val mime = audioMime(name) ?: return response(out, 415, "Unsupported audio extension")
      val id = query["id"]?.takeIf { it.matches(Regex("[a-zA-Z0-9_-]{1,80}")) } ?: return response(out, 400, "Invalid transfer ID")
      if (synchronized(lock) { uploaded.size >= 200 }) return response(out, 429, "Session file limit reached")
      val p = try { note(id, name, size, "upload") } catch (_: Exception) { return response(out, 409, "Transfer already exists") }
      var sink: TransferSink? = null
      try {
        sink = storage.create(name, mime, size)
        val buffer = ByteArray(64 * 1024)
        while (p.received < size) {
          if (!running || Thread.currentThread().isInterrupted) throw InterruptedException()
          val read = input.read(buffer, 0, minOf(buffer.size.toLong(), size - p.received).toInt())
          if (read <= 0) throw IllegalStateException("Upload ended before all bytes arrived")
          sink.output.write(buffer, 0, read); p.received += read
        }
        sink.output.flush(); if (!running) throw InterruptedException()
        synchronized(lock) {
          if (!running) throw InterruptedException()
          val uri = sink.commit()
          uploaded["uploaded-$id"] = TransferFile("uploaded-$id", uri, name, mime, size); p.state = "done"
        }
        response(out, 201, "Created", "{\"ok\":true}", "application/json")
      } catch (_: Exception) {
        try { sink?.abort() } catch (_: Exception) { }
        p.state = if (running) "failed" else "cancelled"; p.error = "Upload incomplete; temporary file removed"
        if (running) response(out, 400, "Upload incomplete")
      }
      return
    }
    response(out, 405, "Method not allowed")
  }
  private fun download(key: String, method: String, out: OutputStream) {
    val file = published[key] ?: synchronized(lock) { uploaded[key] } ?: return response(out, 404, "Not found")
    val source = try { storage.open(file.uri) } catch (_: Exception) { return response(out, 404, "File unavailable") }
    source.use {
      if (source.size !in 0..MAX_FILE_BYTES) return response(out, 413, "File exceeds session limit")
      val p = if (method == "GET") note("get-${UUID.randomUUID()}", file.name, source.size, "download") else null
      val encoded = URLEncoder.encode(file.name, "UTF-8").replace("+", "%20")
      head(out, 200, "OK", file.mime, source.size, "Content-Disposition: attachment; filename=\"music.${file.name.substringAfterLast('.')}\"; filename*=UTF-8''$encoded\r\n")
      if (method == "HEAD") { out.flush(); return }
      try {
        var left = source.size; val buffer = ByteArray(64 * 1024)
        while (left > 0) {
          if (!running || Thread.currentThread().isInterrupted) throw InterruptedException()
          val read = source.input.read(buffer, 0, minOf(left, buffer.size.toLong()).toInt()); if (read <= 0) throw IllegalStateException("File changed")
          out.write(buffer, 0, read); left -= read; p!!.received += read
        }
        out.flush(); p!!.state = "done"
      } catch (_: Exception) { p!!.state = if (running) "failed" else "cancelled"; p.error = "Download interrupted" }
    }
  }
  private fun response(out: OutputStream, code: Int, reason: String, body: String = reason, mime: String = "text/plain; charset=utf-8") {
    val bytes = body.toByteArray(StandardCharsets.UTF_8); head(out, code, reason, mime, bytes.size.toLong()); out.write(bytes); out.flush()
  }
  private fun head(out: OutputStream, code: Int, reason: String, mime: String, length: Long, extra: String = "") {
    out.write(("HTTP/1.1 $code $reason\r\nContent-Type: $mime\r\nContent-Length: $length\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'\r\n${extra}Connection: close\r\n\r\n").toByteArray(StandardCharsets.UTF_8))
  }
  companion object {
    const val MAX_FILE_BYTES = 512L * 1024 * 1024
    fun safeName(value: String?): String? = value?.takeIf { it.isNotBlank() && it.length <= 200 && it != "." && it != ".."
      && it.none { c -> c == '/' || c == '\\' || c.code < 32 || c.code == 127 } && !it.startsWith('.') && !it.endsWith('.') }
    fun audioMime(name: String): String? = when (name.substringAfterLast('.', "").lowercase(Locale.ROOT)) {
      "mp3", "mp2" -> "audio/mpeg"; "flac" -> "audio/flac"; "m4a", "m4b", "mp4", "alac" -> "audio/mp4"; "aac" -> "audio/aac"
      "ogg", "oga", "opus" -> "audio/ogg"; "wav", "wave" -> "audio/wav"; "aif", "aiff" -> "audio/aiff"; "wma" -> "audio/x-ms-wma"; "ape" -> "audio/x-ape"; "wv" -> "audio/x-wavpack"; "dsf", "dff" -> "audio/dsd"; else -> null
    }
    fun parseQuery(query: String): Map<String, String> {
      require(query.length <= 4096); val result = HashMap<String, String>()
      for (part in query.split('&').filter { it.isNotEmpty() }) {
        val key = URLDecoder.decode(part.substringBefore('='), "UTF-8"); val value = URLDecoder.decode(part.substringAfter('=', ""), "UTF-8")
        require(!result.containsKey(key)); result[key] = value
      }; return result
    }
    private fun readHead(input: InputStream): String? {
      val bytes = ArrayList<Byte>(); var tail = 0
      while (bytes.size < 8192) {
        val value = input.read(); if (value < 0) return null; bytes.add(value.toByte()); tail = (tail shl 8) or value
        if (bytes.size >= 4 && tail == 0x0d0a0d0a) return bytes.toByteArray().toString(StandardCharsets.ISO_8859_1)
      }; return null
    }
    private fun json(s: String): String = buildString { append('"'); for (c in s) when (c) { '"' -> append("\\\""); '\\' -> append("\\\\"); '\n' -> append("\\n"); '\r' -> append("\\r"); '\t' -> append("\\t"); else -> if (c.code < 32) append("\\u%04x".format(c.code)) else append(c) }; append('"') }
    private val WEB_PAGE = """<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Resonus Glass · Wi-Fi Transfer</title><style>body{font:16px system-ui;background:#111318;color:#eee;max-width:780px;margin:40px auto;padding:20px}h1{font-size:28px}button,input{font:inherit}button,a{color:#fff;background:#326c50;border:0;border-radius:12px;padding:12px;display:inline-block;text-decoration:none;margin:5px}section{background:#22262e;border-radius:18px;padding:20px;margin:20px 0}p,small{color:#b8bec8}progress{width:100%}.entry{padding:12px 0;border-bottom:1px solid #444}</style><h1>Resonus Glass · Wi-Fi 传歌</h1><p>音乐文件保存在手机 Music / Resonus Glass / Transfer。单个文件最多 512 MiB。<br>Keep the app open. Files are saved on your phone; this temporary link stops when transfer is turned off.</p><section><input type="file" id="pick" accept="audio/*,.flac,.m4a,.m4b,.opus,.aiff,.wma,.ape,.wv,.dsf,.dff" multiple><button id="start">上传 / Upload</button><button id="cancel">取消当前 / Cancel current</button><div id="job"></div></section><section><h2>下载到电脑 / Download</h2><div id="files"></div></section><section><h2>传输进度 / Progress</h2><div id="progress"></div></section><script>
const base=location.pathname.endsWith('/')?location.pathname:location.pathname+'/', byId=id=>document.getElementById(id);let xhr=null,busy=false,cancelled=false;
function line(text,parent){let e=document.createElement('div');e.className='entry';e.textContent=text;parent.append(e);return e}
byId('cancel').onclick=()=>{cancelled=true;if(xhr)xhr.abort()};byId('start').onclick=async()=>{if(busy)return;busy=true;cancelled=false;byId('start').disabled=true;for(const file of byId('pick').files){if(cancelled)break;if(file.size>536870912){byId('job').textContent='文件超过 512 MiB / File too large: '+file.name;continue}let id=crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);await new Promise(done=>{let x=new XMLHttpRequest();xhr=x;x.open('POST',base+'upload?name='+encodeURIComponent(file.name)+'&id='+encodeURIComponent(id));x.upload.onprogress=e=>byId('job').textContent=file.name+' · '+Math.round(e.loaded/e.total*100)+'%';x.onload=()=>{byId('job').textContent=file.name+' · '+(x.status===201?'已保存 / Saved':x.responseText);done()};x.onerror=()=>{byId('job').textContent='连接已断开 / Connection lost';cancelled=true;done()};x.onabort=()=>{byId('job').textContent='已取消 / Cancelled';done()};x.send(file)})}xhr=null;busy=false;byId('start').disabled=false};
let lastFiles='';async function refresh(){try{const r=await fetch(base+'status',{cache:'no-store'});if(!r.ok)throw Error();const s=await r.json();let key=JSON.stringify(s.files);if(key!==lastFiles){lastFiles=key;byId('files').replaceChildren();if(!s.files.length)line('请先在手机选择共享文件，或上传音乐。 Select files on the phone, or upload music.',byId('files'));for(const f of s.files){let e=line(f.name+' · '+(f.bytes/1048576).toFixed(1)+' MiB',byId('files')),a=document.createElement('a');a.textContent='下载 / Download';a.href=base+'files/'+encodeURIComponent(f.key);a.download=f.name;e.append(a)}}byId('progress').replaceChildren();for(const t of s.transfers.slice(-20).reverse()){let e=line(t.name+' · '+t.direction+' · '+t.state,byId('progress')),p=document.createElement('progress');p.max=t.total||1;p.value=t.received;e.append(p)}}catch(_){byId('progress').textContent='连接已结束 / Transfer stopped';return}setTimeout(refresh,1000)}refresh();</script></html>"""
  }
}
