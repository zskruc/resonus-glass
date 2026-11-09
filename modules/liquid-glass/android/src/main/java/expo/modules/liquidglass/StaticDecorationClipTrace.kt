package expo.modules.liquidglass

import android.os.Build
import android.os.Trace
import java.util.concurrent.atomic.AtomicInteger

/** Numeric, lifecycle-only evidence. No trace/log work is added to material drawing. */
internal object StaticDecorationClipTrace {
  private val active = AtomicInteger()
  private val entered = AtomicInteger()

  fun enter() {
    Trace.beginSection("StaticGlassAutoClip:active")
    try {
      val count = active.incrementAndGet()
      val total = entered.incrementAndGet()
      if (Build.VERSION.SDK_INT >= 29) {
        Trace.setCounter("StaticGlassAutoClip.hosts", count.toLong())
        Trace.setCounter("StaticGlassAutoClip.entered", total.toLong())
      }
    } finally { Trace.endSection() }
  }

  fun leave() {
    Trace.beginSection("StaticGlassAutoClip:release")
    try {
      val count = active.decrementAndGet()
      if (Build.VERSION.SDK_INT >= 29) Trace.setCounter("StaticGlassAutoClip.hosts", count.toLong())
    } finally { Trace.endSection() }
  }
}
