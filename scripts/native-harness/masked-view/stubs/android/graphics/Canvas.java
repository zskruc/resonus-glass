package android.graphics;
import java.util.ArrayList;
import java.util.List;
public final class Canvas {
  public final List<Bitmap> appliedMasks = new ArrayList<>();
  public int contentDraws;
  public Canvas() {}
  public Canvas(Bitmap target) {}
  public void drawBitmap(Bitmap bitmap, float x, float y, Paint paint) {
    if (bitmap.isRecycled()) throw new AssertionError("drawing a recycled mask");
    if (!(paint.xfermode instanceof PorterDuffXfermode)) throw new AssertionError("missing DST_IN");
    appliedMasks.add(bitmap);
  }
}
