package android.graphics;
public final class Paint {
  public static final int ANTI_ALIAS_FLAG = 1;
  public Object xfermode;
  public Paint(int flags) {}
  public void setXfermode(Object value) { xfermode = value; }
}
