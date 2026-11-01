package android.graphics;
import java.util.ArrayList;
import java.util.List;
public final class Bitmap {
  public enum Config { ARGB_8888 }
  public static final List<Bitmap> created = new ArrayList<>();
  private boolean recycled;
  private int recycleCalls;
  public static Bitmap createBitmap(int width, int height, Config config) {
    if (width <= 0 || height <= 0) throw new IllegalArgumentException("empty bitmap");
    Bitmap bitmap = new Bitmap(); created.add(bitmap); return bitmap;
  }
  public void recycle() { recycled = true; recycleCalls++; }
  public boolean isRecycled() { return recycled; }
  public int recycleCalls() { return recycleCalls; }
}
