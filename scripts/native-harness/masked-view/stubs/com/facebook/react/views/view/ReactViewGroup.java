package com.facebook.react.views.view;
import android.content.Context;
import android.graphics.Canvas;
import android.view.View;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
public class ReactViewGroup extends View {
  private final List<View> children = new ArrayList<>();
  private final Set<View> transitioning = new HashSet<>();
  private final List<View> disappearing = new ArrayList<>();
  public ReactViewGroup(Context context) { super(context); }
  public void addView(View view) { children.add(view); }
  public void removeView(View view) {
    if (children.remove(view) && transitioning.contains(view)) disappearing.add(view);
  }
  public View getChildAt(int index) { return index >= 0 && index < children.size() ? children.get(index) : null; }
  public void startViewTransition(View view) { transitioning.add(view); }
  public void endViewTransition(View view) { transitioning.remove(view); disappearing.remove(view); }
  protected void dispatchDraw(Canvas canvas) {
    for (View child : children) if (child.getVisibility() == VISIBLE) child.draw(canvas);
    // Android ViewGroup retains these pixels even after getChildAt returns null.
    for (View child : disappearing) if (child.getVisibility() == VISIBLE) child.draw(canvas);
  }
  @Override public void draw(Canvas canvas) { dispatchDraw(canvas); }
}
