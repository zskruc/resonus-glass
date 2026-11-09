import expo.modules.localhttp.*
import java.io.*
import java.net.*
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Uses the production socket server against a temporary filesystem adapter. */
private class Storage(val root: File) : TransferStorage {
  var aborted = 0
  override fun create(name: String, mime: String, size: Long): TransferSink {
    val temp = File.createTempFile("incoming-", ".partial", root); val stream = FileOutputStream(temp)
    return object : TransferSink {
      override val output = stream
      var done = false
      override fun commit(): String { stream.close(); val final = File(root, "${System.nanoTime()}-$name"); check(temp.renameTo(final)); done = true; return final.toURI().toString().replace("file:/", "file:///") }
      override fun abort() { stream.close(); if (!done) { temp.delete(); aborted++ } }
    }
  }
  override fun open(uri: String): TransferRead { val f = File(URI(uri)); check(f.canonicalFile.parentFile == root.canonicalFile); return TransferRead(FileInputStream(f), f.length()) }
}
fun main() {
  val root = Files.createTempDirectory("resonus-transfer-").toFile(); val storage = Storage(root); val server = TransferServer(storage)
  var checks = 0
  fun checkThat(value: Boolean) { check(value) { "Check $checks failed" }; checks++ }
  try {
    val origin = URI(server.start("127.0.0.1")); val port = origin.port; val tokenPath = origin.path
    fun request(path: String = tokenPath, method: String = "GET", body: ByteArray = ByteArray(0), headers: String = "", declared: Long = body.size.toLong()): String {
      return Socket("127.0.0.1", port).use { client ->
        client.soTimeout = 4000
        client.getOutputStream().write(("$method $path HTTP/1.1\r\nHost: 127.0.0.1:$port\r\nContent-Length: $declared\r\n${headers}\r\n").toByteArray())
        client.getOutputStream().write(body); client.getOutputStream().flush(); client.shutdownOutput()
        client.getInputStream().readBytes().toString(Charsets.UTF_8)
      }
    }
    checkThat(request().startsWith("HTTP/1.1 200")); checkThat(request().contains("Wi-Fi"))
    checkThat(request("/badtoken/status").startsWith("HTTP/1.1 404"))
    checkThat(request(tokenPath+"status").contains("\"uploads\":[]"))
    val bytes = "fLaC genuine transfer bytes\u0000".toByteArray()
    val uploadPath = tokenPath + "upload?name=" + URLEncoder.encode("晴天.flac", "UTF-8") + "&id=first"
    checkThat(request(uploadPath, "POST", bytes).startsWith("HTTP/1.1 403"))
    val same = "Origin: http://127.0.0.1:$port\r\n"
    checkThat(request(uploadPath, "POST", bytes, same).startsWith("HTTP/1.1 201"))
    checkThat(root.listFiles()!!.filter { !it.name.endsWith(".partial") }.single().readBytes().contentEquals(bytes))
    checkThat(request(uploadPath, "POST", bytes, same).startsWith("HTTP/1.1 409"))
    checkThat(request(tokenPath+"upload?name=..%2Fprivate.flac&id=bad", "POST", bytes, same).startsWith("HTTP/1.1 400"))
    checkThat(request(tokenPath+"upload?name=x.html&id=bad", "POST", bytes, same).startsWith("HTTP/1.1 415"))
    checkThat(request(tokenPath+"upload?name=x.mp3&id=big", "POST", ByteArray(0), same, TransferServer.MAX_FILE_BYTES+1).startsWith("HTTP/1.1 413"))
    checkThat(request(tokenPath+"upload?name=x.mp3&id=short", "POST", bytes, same, bytes.size.toLong()+10).startsWith("HTTP/1.1 400"))
    checkThat(storage.aborted == 1 && root.listFiles()!!.none { it.name.endsWith(".partial") })
    val publicState = request(tokenPath+"status"); checkThat(publicState.contains("uploaded-first") && !publicState.contains("file:"))
    val get = request(tokenPath+"files/uploaded-first"); checkThat(get.endsWith(bytes.toString(Charsets.UTF_8)))
    checkThat(request(tokenPath+"files/uploaded-first", "HEAD").substringAfter("\r\n\r\n").isEmpty())
    checkThat(server.statusJson().contains("\"uri\":\"file:"))
    checkThat(TransferServer.safeName("a\r\nb.mp3") == null && TransferServer.safeName(".hidden.mp3") == null)
    checkThat(runCatching { TransferServer.parseQuery("name=x&name=y") }.isFailure)
    val selected = File(root, "selected.flac").apply { writeBytes(bytes) }
    server.setEntries(listOf(TransferFile("selected", selected.toURI().toString().replace("file:/", "file:///"), "selected.flac", "audio/flac", selected.length())))
    checkThat(request(tokenPath+"files/selected").endsWith(bytes.toString(Charsets.UTF_8)))
    checkThat(runCatching { server.setEntries(listOf(TransferFile("escape", "https://evil/file", "file.mp3", "audio/mpeg", 4))) }.isFailure)
    val pending = Socket("127.0.0.1", port); pending.soTimeout = 3000
    pending.getOutputStream().write(("POST ${tokenPath}upload?name=cancel.mp3&id=cancel HTTP/1.1\r\nHost: 127.0.0.1:$port\r\nOrigin: http://127.0.0.1:$port\r\nContent-Length: 999999\r\n\r\na").toByteArray()); pending.getOutputStream().flush()
    Thread.sleep(100); server.stop(); pending.close(); Thread.sleep(100)
    checkThat(server.origin() == null && server.statusJson().contains("\"running\":false"))
    checkThat(root.listFiles()!!.none { it.name.endsWith(".partial") })
    checkThat(runCatching { Socket("127.0.0.1", port).close() }.isFailure)
    val next = TransferServer(storage); val second = next.start("127.0.0.1"); checkThat(URI(second).path != tokenPath); next.stop()
    println("PASS: $checks native Wi-Fi transfer checks (real HTTP upload/download, bytes, token, origin, limits, cleanup and stop)")
  } finally { server.stop(); root.deleteRecursively() }
}
