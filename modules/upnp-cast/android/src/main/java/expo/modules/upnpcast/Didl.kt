package expo.modules.upnpcast

data class Track(
  val url: String,
  val mime: String,
  val title: String,
  val artist: String?,
  val albumArtist: String?,
  val album: String?,
  val artworkUrl: String?,
  val durationSeconds: Int,
  /** The song's id in the app, handed back so it can tell which one is playing. */
  val id: String? = null
)

object Didl {
  fun forQueueContainer(queueUri: String, childCount: Int): String = buildString {
    append("<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\"")
    append(" xmlns:dc=\"http://purl.org/dc/elements/1.1/\"")
    append(" xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\"")
    append(" xmlns:r=\"urn:schemas-rinconnetworks-com:metadata-1-0/\">")
    append("<container id=\"Q:0\" parentID=\"Q:\" restricted=\"true\" childCount=\"")
    append(childCount.coerceAtLeast(0))
    append("\">")
    append("<dc:title>Queue Instance 0</dc:title>")
    append("<upnp:class>object.container.playlistContainer</upnp:class>")
    append("<res protocolInfo=\"x-rincon-queue:*:*:*\">")
    append(Soap.escape(queueUri))
    append("</res>")
    append("</container></DIDL-Lite>")
  }

  fun forTrack(track: Track): String = buildString {
    append("<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\"")
    append(" xmlns:dc=\"http://purl.org/dc/elements/1.1/\"")
    append(" xmlns:r=\"urn:schemas-rinconnetworks-com:metadata-1-0/\"")
    append(" xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\">")
    append("<item id=\"0\" parentID=\"-1\" restricted=\"1\">")
    append("<dc:title>").append(Soap.escape(track.title)).append("</dc:title>")
    track.artist?.takeIf { it.isNotBlank() }?.let {
      append("<upnp:artist>").append(Soap.escape(it)).append("</upnp:artist>")
      append("<dc:creator>").append(Soap.escape(it)).append("</dc:creator>")
    }
    track.albumArtist?.takeIf { it.isNotBlank() }?.let {
      append("<upnp:albumArtist>").append(Soap.escape(it)).append("</upnp:albumArtist>")
    }
    track.album?.takeIf { it.isNotBlank() }?.let {
      append("<upnp:album>").append(Soap.escape(it)).append("</upnp:album>")
    }
    track.artworkUrl
      ?.takeIf { it.startsWith("http://") || it.startsWith("https://") }
      ?.let {
        append("<upnp:albumArtURI>").append(Soap.escape(it)).append("</upnp:albumArtURI>")
      }
    append("<upnp:class>object.item.audioItem.musicTrack</upnp:class>")
    append("<res protocolInfo=\"http-get:*:").append(Soap.escape(track.mime)).append(":*\"")
    if (track.durationSeconds > 0) {
      append(" duration=\"").append(hms(track.durationSeconds)).append("\"")
    }
    append(">")
    append(Soap.escape(track.url))
    append("</res>")
    append("</item></DIDL-Lite>")
  }

  fun hms(seconds: Int): String {
    val safe = seconds.coerceAtLeast(0)
    return "%d:%02d:%02d".format(safe / 3600, (safe % 3600) / 60, safe % 60)
  }

  fun parseDuration(value: String?): Long {
    if (value.isNullOrBlank()) return 0
    val parts = value.trim().split(':')
    if (parts.isEmpty() || parts.size > 3) return 0
    var total = 0.0
    for (part in parts) {
      val number = part.toDoubleOrNull() ?: return 0
      total = total * 60 + number
    }
    return (total * 1000).toLong()
  }
}
