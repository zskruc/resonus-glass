import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.view.View;
import java.lang.reflect.Field;
import org.reactnative.maskedview.RNCMaskedView;

public final class Harness {
  private static final Context context = new Context();
  private static int assertions;
  private static final class Host extends RNCMaskedView {
    Host() { super(context); onAttachedToWindow(); }
    Canvas render() { Canvas canvas = new Canvas(); dispatchDraw(canvas); return canvas; }
    void attach() { onAttachedToWindow(); }
    void detach() { onDetachedFromWindow(); }
    void dirty() { onLayout(true, 0, 0, 240, 520); }
  }
  private static void check(boolean condition, String message) {
    assertions++; if (!condition) throw new AssertionError(message);
  }
  private static Object field(Host host, String name) {
    try { Field field = RNCMaskedView.class.getDeclaredField(name); field.setAccessible(true); return field.get(host); }
    catch (ReflectiveOperationException failure) { throw new AssertionError(failure); }
  }
  private static Bitmap mask(Host host) { return (Bitmap) field(host, "mBitmapMask"); }
  private static View picture() { return new View(context); }

  private static void removedMaskRetainsItsRasterThroughNativeExit() {
    Host host = new Host(); View element = picture(), image = picture();
    host.addView(element); host.addView(image); host.render(); Bitmap original = mask(host);
    host.startViewTransition(element); host.startViewTransition(image);
    host.removeView(element); host.removeView(image);
    check(host.getChildAt(0) == null, "Fabric has logically removed all children");
    int allocations = Bitmap.created.size();
    for (int frame = 0; frame < 120; frame++) {
      host.dirty(); Canvas canvas = host.render();
      check(canvas.contentDraws > 0, "native exit still draws the disappearing photograph");
      check(canvas.appliedMasks.size() == 1 && canvas.appliedMasks.get(0) == original,
        "every exit frame must apply the exact same mask to those pixels");
      check(!original.isRecycled(), "a visible exit cannot recycle its mask");
    }
    check(Bitmap.created.size() == allocations, "native exit must not allocate another mask per frame");
    host.endViewTransition(image); check(mask(host) == original, "other child endings cannot release the mask");
    host.endViewTransition(element);
    check(mask(host) == null && original.isRecycled(), "completed removal releases the raster");
    check(field(host, "mTransitionMaskView") == null, "completed transition releases its child reference");
    host.detach(); check(original.recycleCalls() == 1, "detach cannot double recycle");
  }

  private static void reorderedAndZeroSizeMasksCannotReplaceAnExitingRaster() {
    Host host = new Host(); View element = picture(), image = picture();
    host.addView(element); host.addView(image); host.render(); Bitmap original = mask(host);
    host.startViewTransition(element); host.removeView(element); element.measureBox(0, 0);
    host.dirty(); Canvas canvas = host.render();
    check(host.getChildAt(0) == image, "a reordered content image is now the logical first child");
    check(mask(host) == original && canvas.appliedMasks.get(0) == original,
      "reordered or zero-size child cannot replace the exiting mask");
    host.detach(); check(original.isRecycled(), "real detach releases even without a matching end event");
    check(field(host, "mTransitionMaskView") == null, "real detach releases the exact child reference");
  }

  private static void normalRemovalAndEmptyLayoutStillReleaseMemory() {
    Host host = new Host(); View element = picture(); host.addView(element); host.render();
    Bitmap original = mask(host); host.removeView(element); host.render();
    check(mask(host) == null && original.isRecycled(), "nontransition mask removal must retain no raster");
    host.addView(element); host.dirty(); host.render(); original = mask(host);
    element.measureBox(0, 0); host.dirty(); host.render();
    check(mask(host) == null && original.isRecycled(), "nontransition empty mask still releases its raster"); host.detach();
  }

  private static void replacementPublishesAtomicallyAndCleansFailedTemporaryRaster() {
    Host host = new Host(); View element = picture(); host.addView(element); host.render();
    Bitmap original = mask(host);
    element.duringDraw = () -> check(mask(host) == original && !original.isRecycled(),
      "a replacement must finish drawing before retiring the previous raster");
    host.dirty(); host.render(); Bitmap replacement = mask(host);
    check(replacement != original && original.isRecycled(), "successful replacement retires the old raster once");
    element.duringDraw = () -> { throw new IllegalStateException("draw failed"); };
    host.dirty(); int before = Bitmap.created.size();
    try { host.render(); throw new AssertionError("expected replacement failure"); }
    catch (IllegalStateException expected) { check("draw failed".equals(expected.getMessage()), "original failure is preserved"); }
    check(mask(host) == replacement && !replacement.isRecycled(), "failed replacement preserves the current valid raster");
    check(Bitmap.created.size() == before + 1 && Bitmap.created.get(before).isRecycled(), "failed temporary bitmap is released");
    check(element.getVisibility() == View.INVISIBLE, "failed drawing still restores invisible mask element");
    element.duringDraw = null; host.detach(); check(replacement.isRecycled(), "detach releases the final valid raster");
  }

  private static void transitionEndRebuildsAttachedMaskAndReattachStartsFresh() {
    Host host = new Host(); View element = picture(); host.addView(element); host.render(); Bitmap original = mask(host);
    host.startViewTransition(element); element.measureBox(100, 80); host.dirty(); host.render();
    check(mask(host) == original, "exit keeps its stable mask geometry");
    host.endViewTransition(element); host.render(); Bitmap next = mask(host);
    check(next != original && original.isRecycled(), "an attached/cancelled transition resumes normal mask updates");
    host.startViewTransition(element); host.detach(); check(next.isRecycled(), "detach releases transition-owned raster");
    host.attach(); host.render(); check(mask(host) != next && !mask(host).isRecycled(), "reattach rebuilds native ownership");
    host.detach();
  }

  private static void firstTransitionCapturesPendingMaskAndDuplicateEndIsHarmless() {
    Host host = new Host(); View element = picture(); host.addView(element);
    host.startViewTransition(element); Bitmap original = mask(host);
    check(original != null, "a not-yet-drawn mask is captured before removal");
    host.removeView(element); host.render(); check(mask(host) == original, "first exit frame remains masked");
    host.endViewTransition(element); host.endViewTransition(element); host.detach();
    check(original.recycleCalls() == 1, "duplicate completion cannot double recycle");
  }

  private static void zeroLayoutBeforeTransitionRetainsLastValidMaskOrDrawsNothing() {
    Host host = new Host(); View element = picture(), image = picture();
    host.addView(element); host.addView(image); host.render(); Bitmap original = mask(host);
    element.measureBox(0, 0); host.dirty(); host.startViewTransition(element);
    host.startViewTransition(image); host.removeView(element); host.removeView(image);
    Canvas canvas = host.render();
    check(mask(host) == original && canvas.appliedMasks.get(0) == original,
      "zero layout immediately before transition cannot discard the last visible raster");
    host.detach();
    Host empty = new Host(); View zero = picture(), content = picture(); zero.measureBox(0, 0);
    empty.addView(zero); empty.addView(content); empty.startViewTransition(zero); empty.startViewTransition(content);
    empty.removeView(zero); empty.removeView(content); Canvas hidden = empty.render();
    check(hidden.contentDraws == 0 && hidden.appliedMasks.isEmpty(), "an exit without any valid raster must fail closed");
    empty.detach();
  }

  public static void main(String[] args) {
    removedMaskRetainsItsRasterThroughNativeExit();
    reorderedAndZeroSizeMasksCannotReplaceAnExitingRaster();
    normalRemovalAndEmptyLayoutStillReleaseMemory();
    replacementPublishesAtomicallyAndCleansFailedTemporaryRaster();
    transitionEndRebuildsAttachedMaskAndReattachStartsFresh();
    firstTransitionCapturesPendingMaskAndDuplicateEndIsHarmless();
    zeroLayoutBeforeTransitionRetainsLastValidMaskOrDrawsNothing();
    for (Bitmap bitmap : Bitmap.created) check(bitmap.isRecycled(), "harness must finish without retaining bitmap allocations");
    System.out.println("MaskedView production-Java lifecycle harness passed: " + assertions + " assertions");
  }
}
