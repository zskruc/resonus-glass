package android.view;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
public class View {
  public static final int VISIBLE = 0, INVISIBLE = 4, LAYER_TYPE_HARDWARE = 2, LAYER_TYPE_SOFTWARE = 1;
  private int width = 240, height = 520, visibility = VISIBLE;
  public Runnable duringDraw;
  public View(Context context) {}
  public void setVisibility(int value) { visibility = value; }
  public int getVisibility() { return visibility; }
  public int getMeasuredWidth() { return width; }
  public int getMeasuredHeight() { return height; }
  public void measureBox(int w, int h) { width = w; height = h; }
  public void layout(int left, int top, int right, int bottom) { onLayout(true, left, top, right, bottom); }
  public void draw(Canvas canvas) { canvas.contentDraws++; if (duringDraw != null) duringDraw.run(); }
  public void invalidate() {}
  public void setLayerType(int mode, Paint paint) {}
  public void onDescendantInvalidated(View child, View target) {}
  protected void onLayout(boolean changed, int left, int top, int right, int bottom) {}
  protected void onAttachedToWindow() {}
  protected void onDetachedFromWindow() {}
}
