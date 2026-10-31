package androidx.media3.decoder.ffmpeg;

import androidx.media3.common.Format;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.decoder.DecoderInputBuffer;
import androidx.media3.decoder.SimpleDecoderOutputBuffer;
import java.nio.ByteBuffer;
import java.util.Arrays;
import java.util.Collections;

/**
 * Separate decoder context for bounded, read-only audio inspection. The live
 * renderer and its packet queues are never touched by this helper.
 */
@UnstableApi
public final class AlacPcmInspector implements AutoCloseable {
  private final FfmpegAudioDecoder decoder;
  private final DecoderInputBuffer input;
  private final SimpleDecoderOutputBuffer output;

  public AlacPcmInspector(int sampleRate, int channelCount, byte[] config)
      throws FfmpegDecoderException {
    // Media3 supplies the 24-byte cookie. Some framework extractors return
    // the containing 12-byte ALAC atom header as well.
    byte[] cookie = config;
    if (config.length == 36 && config[4] == 'a' && config[5] == 'l'
        && config[6] == 'a' && config[7] == 'c') {
      cookie = Arrays.copyOfRange(config, 12, 36);
    }
    if (cookie.length != 24) throw new FfmpegDecoderException("Unsupported ALAC configuration");
    int depth = cookie[5] & 255;
    int channels = cookie[9] & 255;
    long rate = unsigned32(cookie, 20);
    long frames = unsigned32(cookie, 0);
    if ((depth != 8 && depth != 16 && depth != 20 && depth != 24 && depth != 32)
        || channels < 1 || channels > 8 || channels != channelCount
        || rate != sampleRate || rate < 8000 || rate > 384000
        || frames < 1 || frames > 65536) {
      throw new FfmpegDecoderException("Invalid ALAC configuration");
    }
    // FfmpegAudioDecoder starts a worker in its super constructor. Reject
    // unavailable native code before creating that worker for inspection.
    if (!FfmpegLibrary.isAvailable() || !FfmpegLibrary.supportsFormat(MimeTypes.AUDIO_ALAC)) {
      throw new FfmpegDecoderException("ALAC decoder is unavailable");
    }
    Format format = new Format.Builder().setSampleMimeType(MimeTypes.AUDIO_ALAC)
        .setSampleRate(sampleRate).setChannelCount(channelCount)
        .setInitializationData(Collections.singletonList(cookie)).build();
    decoder = new FfmpegAudioDecoder(format, 1, 1, 65536, false);
    input = decoder.createInputBuffer();
    output = new SimpleDecoderOutputBuffer(buffer -> {});
  }

  private static long unsigned32(byte[] value, int offset) {
    return ((value[offset] & 255L) << 24) | ((value[offset + 1] & 255L) << 16)
        | ((value[offset + 2] & 255L) << 8) | (value[offset + 3] & 255L);
  }

  /** Returned buffer is valid only until the next packet is decoded. */
  public ByteBuffer decode(ByteBuffer packet, long timeUs) throws FfmpegDecoderException {
    input.clear();
    input.ensureSpaceForWrite(packet.remaining());
    if (input.data == null) throw new FfmpegDecoderException("Missing ALAC input buffer");
    input.data.put(packet);
    input.timeUs = timeUs;
    input.flip();
    output.clear();
    FfmpegDecoderException error = decoder.decode(input, output, false);
    if (error != null) throw error;
    return output.shouldBeSkipped || output.data == null ? null : output.data.asReadOnlyBuffer();
  }

  public int sampleRate() { return decoder.getSampleRate(); }
  public int channelCount() { return decoder.getChannelCount(); }
  public int encoding() { return decoder.getEncoding(); }

  @Override public void close() { decoder.release(); }
}
