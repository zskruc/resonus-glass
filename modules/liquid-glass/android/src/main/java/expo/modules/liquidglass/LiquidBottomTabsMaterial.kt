/*
 * Interactive material adapted from Kyant0/AndroidLiquidGlass LiquidBottomTabs:
 * https://github.com/Kyant0/AndroidLiquidGlass/blob/kmp/app/src/commonMain/kotlin/com/kyant/backdrop/catalog/components/LiquidBottomTabs.kt
 * Copyright Kyant0. Licensed under Apache-2.0; see ANDROID_LIQUID_GLASS_LICENSE.
 * RN owns navigation, labels, font settings, accessibility and pointer gestures.
 * AM++ preset adapts panel squeeze, clipped press light and collapsing light anchor
 * from Kifranei/AM-plus-plus commit 97fa2e4efc9ec7476daca383221f55b5d10f847c
 * (GPL-3.0); original Kyant shader and material remain Apache-2.0.
 */
package expo.modules.liquidglass

import android.util.Log
import android.os.Build
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.AbsoluteAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.GraphicsLayerScope
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.draw
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.backdrops.rememberCanvasBackdrop
import com.kyant.backdrop.backdrops.rememberCombinedBackdrop
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.effects.vibrancy
import com.kyant.backdrop.highlight.Highlight
import com.kyant.backdrop.shadow.InnerShadow
import com.kyant.backdrop.shadow.Shadow
import kotlin.math.abs
import kotlin.math.roundToInt

/** Records one material for the selected lens without another screen capture. */
private class SinglePassTabsBackdrop(
  val layer: GraphicsLayer,
  val selectorScaleX: () -> Float,
  val selectorScaleY: () -> Float
) : Backdrop {
  var sourceCoordinates: LayoutCoordinates? by mutableStateOf(null)
  override val isCoordinatesDependent = true

  override fun DrawScope.drawBackdrop(
    density: Density,
    coordinates: LayoutCoordinates?,
    layerBlock: (GraphicsLayerScope.() -> Unit)?
  ) {
    val target = coordinates ?: return
    val source = sourceCoordinates ?: return
    if (!target.isAttached || !source.isAttached) return
    withTransform({
      if (layerBlock != null) scale(1f / selectorScaleX(), 1f / selectorScaleY(), Offset.Zero)
      val offset = try { source.localPositionOf(target) }
        catch (_: IllegalArgumentException) { target.positionInWindow() - source.positionInWindow() }
      translate(-offset.x, -offset.y)
    }) { drawLayer(layer) }
  }
}

private fun Modifier.recordTabsBackdrop(
  backdrop: SinglePassTabsBackdrop?,
  drawRecordedToScreen: Boolean = true
): Modifier {
  if (backdrop == null) return this
  return onGloballyPositioned { backdrop.sourceCoordinates = it }.drawWithContent {
    backdrop.layer.record(
      density = this,
      layoutDirection = layoutDirection,
      size = IntSize(size.width.roundToInt(), size.height.roundToInt())
    ) {
      this@drawWithContent.draw(
        density = drawContext.density,
        layoutDirection = drawContext.layoutDirection,
        canvas = drawContext.canvas,
        size = drawContext.size,
        graphicsLayer = drawContext.graphicsLayer
      ) { this@drawWithContent.drawContent() }
    }
    if (drawRecordedToScreen) drawLayer(backdrop.layer)
  }
}

private fun DrawScope.drawTabsInteractiveHighlight(progress: Float, center: Offset) {
  if (progress <= 0f) return
  drawRect(Color.White.copy(alpha = 0.08f * progress), blendMode = BlendMode.Plus)
  drawRect(
    Brush.radialGradient(listOf(Color.White.copy(alpha = 0.15f * progress), Color.Transparent),
      center = center, radius = size.height * 1.5f),
    blendMode = BlendMode.Plus
  )
}

/** Reference smoothstep light, clipped so a compact circle never leaves a square halo. */
internal class AmPlusInteractiveHighlight {
  private val shader = if (Build.VERSION.SDK_INT >= 33) android.graphics.RuntimeShader("""
uniform float2 size;
layout(color) uniform half4 color;
uniform float radius;
uniform float2 position;
half4 main(float2 coord) {
  float dist = distance(coord, position);
  float intensity = smoothstep(radius, radius * 0.5, dist);
  return color * intensity;
}
""") else null
  private val shaderBrush = shader?.let { ShaderBrush(it) }
  private val clip = Path()
  private var clipWidth = -1f
  private var clipHeight = -1f

  fun DrawScope.draw(progress: Float, center: Offset) {
    val p = progress.coerceIn(0f, 1f)
    if (p <= 0f || size.minDimension <= 0f) return
    if (clipWidth != size.width || clipHeight != size.height) {
      clipWidth = size.width
      clipHeight = size.height
      clip.reset()
      clip.addRoundRect(RoundRect(0f, 0f, size.width, size.height, CornerRadius(size.minDimension / 2f)))
    }
    clipPath(clip) {
      val light = shader
      if (light != null && Build.VERSION.SDK_INT >= 33) {
        drawRect(Color.White.copy(alpha = 0.08f * p), blendMode = BlendMode.Plus)
        light.setFloatUniform("size", size.width, size.height)
        light.setColorUniform("color", android.graphics.Color.argb(0.15f * p, 1f, 1f, 1f))
        light.setFloatUniform("radius", size.minDimension * 1.5f)
        light.setFloatUniform("position", center.x.coerceIn(0f, size.width), center.y.coerceIn(0f, size.height))
        drawRect(shaderBrush!!, blendMode = BlendMode.Plus)
      } else drawRect(Color.White.copy(alpha = 0.25f * p), blendMode = BlendMode.Plus)
    }
  }
}

@Composable
internal fun LiquidBottomTabsMaterial(
  backdrop: Backdrop,
  tabsCount: Int,
  horizontalInset: Float,
  verticalInset: Float,
  position: () -> Float,
  pressProgress: () -> Float,
  pressedScaleX: () -> Float,
  pressedScaleY: () -> Float,
  velocity: () -> Float,
  panelOffset: () -> Float,
  selectionOpacity: () -> Float,
  officialMaterial: Boolean,
  amPlusMaterial: Boolean,
  tuningMask: Int,
  dockProgress: () -> Float,
  blurRadius: Float,
  refraction: Float,
  refractionHeight: Float,
  highlightWidth: Float,
  highlightOpacity: Float,
  depthEffect: Boolean,
  chromaticAberration: Boolean,
  tint: Color,
  tintOpacity: () -> Float,
  dark: Boolean
) {
  val amPlusHighlight = if (amPlusMaterial) remember { AmPlusInteractiveHighlight() } else null
  val selectionVisible by remember(amPlusMaterial) {
    derivedStateOf { !amPlusMaterial || selectionOpacity() > 0.001f }
  }
  // Derived state changes composition only on entering/leaving interaction.
  // At rest, alpha-zero highlight/shadow modifiers still record GPU layers in
  // Backdrop 1.0.0, so omit the entire selected-lens stack, not just its effect.
  val interacting by remember(amPlusMaterial) {
    derivedStateOf {
      selectionVisible && (pressProgress() > 0.001f || abs(pressedScaleX() - 1f) > 0.001f ||
        abs(pressedScaleY() - 1f) > 0.001f || abs(velocity()) > 0.001f || abs(panelOffset()) > 0.001f
      )
    }
  }
  LaunchedEffect(interacting) {
    Log.d("ResonusTabsMaterial", "interacting=$interacting press=${pressProgress()} " +
      "scaleX=${pressedScaleX()} scaleY=${pressedScaleY()} velocity=${velocity()} offset=${panelOffset()}")
  }
  val materialBackdrop = if (interacting) {
    val layer = rememberGraphicsLayer()
    remember(layer) {
      SinglePassTabsBackdrop(layer,
        selectorScaleX = { pressedScaleX() / (1f - (velocity() / 10f * 0.75f).coerceIn(-0.2f, 0.2f)) },
        selectorScaleY = { pressedScaleY() * (1f - (velocity() / 10f * 0.25f).coerceIn(-0.2f, 0.2f)) })
    }
  } else null
  // Positions below are physical canvas coordinates; RN mirrors semantic tabs.
  BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = AbsoluteAlignment.TopLeft) {
    val density = LocalDensity.current
    val widthPx = constraints.maxWidth.toFloat()
    val heightPx = constraints.maxHeight.toFloat()
    val insetPx = with(density) { horizontalInset.dp.toPx() }
    val topPx = with(density) { verticalInset.dp.toPx() }
    val tabWidthPx = ((widthPx - insetPx * 2f) / tabsCount.coerceAtLeast(1)).coerceAtLeast(0f)
    val tabHeightPx = (heightPx - topPx * 2f).coerceAtLeast(0f)
    val tabWidth = with(density) { tabWidthPx.toDp() }
    val tabHeight = with(density) { tabHeightPx.toDp() }
    val panelScene = rememberCanvasBackdrop {
      val panelScale = 1f + (if (amPlusMaterial) 8f else 16f).dp.toPx() / widthPx.coerceAtLeast(1f) * pressProgress()
      val offsetPx = with(density) { panelOffset().dp.toPx() }
      withTransform({
        scale(1f / panelScale, 1f / panelScale, Offset(widthPx / 2f, heightPx / 2f))
        translate(-offsetPx, 0f)
      }) {
        with(backdrop) { drawBackdrop(density, null, null) }
      }
    }

    Box(
      Modifier.fillMaxSize().graphicsLayer {
        translationX = panelOffset().dp.toPx()
      }.recordTabsBackdrop(if (officialMaterial) null else materialBackdrop).drawBackdrop(
        backdrop = panelScene,
        shape = { RoundedCornerShape(50) },
        effects = {
          vibrancy()
          blur(blurRadius.dp.toPx())
          lens(refractionHeight.dp.toPx(), refraction.dp.toPx(),
            depthEffect = depthEffect, chromaticAberration = chromaticAberration)
        },
        highlight = {
          if (officialMaterial && (tuningMask and (MaterialTuningMask.HIGHLIGHT_WIDTH or MaterialTuningMask.HIGHLIGHT_ALPHA)) == 0)
            Highlight.Default
          else Highlight(width = highlightWidth.dp, alpha = highlightOpacity)
        },
        shadow = if (officialMaterial) ({ Shadow.Default }) else null,
        layerBlock = {
          val scale = 1f + (if (amPlusMaterial) 8f else 16f).dp.toPx() / size.width.coerceAtLeast(1f) * pressProgress()
          scaleX = scale
          scaleY = scale
        },
        onDrawSurface = { drawRect(tint.copy(alpha = tintOpacity() * tint.alpha)) },
        onDrawFront = {
          val progress = pressProgress()
          if (progress > 0f) {
            val boundedPosition = position().coerceIn(0f, (tabsCount - 1).toFloat())
            val tabCenter = insetPx + (boundedPosition + 0.5f) * tabWidthPx
            if (amPlusHighlight != null) {
              val collapse = dockProgress().coerceIn(0f, 1f)
              val center = tabCenter + (size.width / 2f - tabCenter) * collapse
              with(amPlusHighlight) { draw(progress, Offset(center, size.height / 2f)) }
            } else drawTabsInteractiveHighlight(progress, Offset(tabCenter, size.height / 2f))
          }
        }
      )
    )

    // Do not retain invisible selected-lens layers after the expanded row has faded.
    if (!selectionVisible) return@BoxWithConstraints

    if (materialBackdrop == null) {
      Box(Modifier.width(tabWidth).height(tabHeight).graphicsLayer {
        translationX = insetPx + position().coerceIn(0f, (tabsCount - 1).toFloat()) * tabWidthPx
        translationY = topPx
        alpha = selectionOpacity()
      }.drawWithContent {
        drawRoundRect((if (dark) Color.White else Color.Black).copy(alpha = 0.1f),
          cornerRadius = CornerRadius(size.height / 2f))
        drawContent()
      })
      return@BoxWithConstraints
    }

    if (officialMaterial) {
      // The catalog's selected lens samples a separate, progress-dependent
      // material, not the visible bar's fixed 24/24 lens. Record it only while
      // interacting; do not display it or duplicate RN labels and icons.
      val auxiliaryScene = rememberCanvasBackdrop {
        val offsetPx = with(density) { panelOffset().dp.toPx() }
        withTransform({ translate(-offsetPx, -topPx) }) {
          with(backdrop) { drawBackdrop(density, null, null) }
        }
      }
      Box(
        Modifier.fillMaxWidth().height(tabHeight).graphicsLayer {
          translationX = panelOffset().dp.toPx()
          translationY = topPx
        }.recordTabsBackdrop(materialBackdrop, drawRecordedToScreen = false).drawBackdrop(
          backdrop = auxiliaryScene,
          shape = { RoundedCornerShape(50) },
          effects = {
            val progress = pressProgress()
            vibrancy()
            blur((if (amPlusMaterial) blurRadius else 8f).dp.toPx())
            lens((if (amPlusMaterial) refractionHeight else 24f).dp.toPx() * progress,
              (if (amPlusMaterial) refraction else 24f).dp.toPx() * progress,
              depthEffect = amPlusMaterial && depthEffect,
              chromaticAberration = amPlusMaterial && chromaticAberration)
          },
          highlight = {
            if (amPlusMaterial && (tuningMask and (MaterialTuningMask.HIGHLIGHT_WIDTH or MaterialTuningMask.HIGHLIGHT_ALPHA)) != 0)
              Highlight(width = highlightWidth.dp, alpha = highlightOpacity * pressProgress())
            else Highlight.Default.copy(alpha = pressProgress())
          },
          shadow = { Shadow.Default },
          onDrawSurface = { drawRect(tint.copy(alpha = tintOpacity() * tint.alpha)) },
          onDrawFront = {
            val boundedPosition = position().coerceIn(0f, (tabsCount - 1).toFloat())
            val tabCenter = insetPx + (boundedPosition + 0.5f) * tabWidthPx
            if (amPlusHighlight != null) {
              val collapse = dockProgress().coerceIn(0f, 1f)
              val center = tabCenter + (size.width / 2f - tabCenter) * collapse
              with(amPlusHighlight) { draw(pressProgress(), Offset(center, size.height / 2f)) }
            } else drawTabsInteractiveHighlight(pressProgress(), Offset(tabCenter, size.height / 2f))
          }
        )
      )
    }

    // CanvasBackdrop has no layout coordinates. Offset the same retained scene
    // to the selected tab; the native recorded material layer aligns itself.
    // No second screen capture or per-frame bitmap allocation is introduced.
    val selectedScene = rememberCanvasBackdrop {
      val speed = velocity() / 10f
      val actualScaleX = pressedScaleX() / (1f - (speed * 0.75f).coerceIn(-0.2f, 0.2f))
      val actualScaleY = pressedScaleY() * (1f - (speed * 0.25f).coerceIn(-0.2f, 0.2f))
      val offsetPx = with(density) { panelOffset().dp.toPx() }
      val boundedPosition = position().coerceIn(0f, (tabsCount - 1).toFloat())
      withTransform({
        scale(1f / actualScaleX, 1f / actualScaleY, Offset(tabWidthPx / 2f, tabHeightPx / 2f))
        translate(-(insetPx + boundedPosition * tabWidthPx + offsetPx), -topPx)
      }) {
        with(backdrop) { drawBackdrop(density, null, null) }
      }
    }
    val selectedBackdrop = rememberCombinedBackdrop(selectedScene, materialBackdrop)
    Box(
      Modifier.width(tabWidth).height(tabHeight).graphicsLayer {
        translationX = insetPx + position().coerceIn(0f, (tabsCount - 1).toFloat()) * tabWidthPx + panelOffset().dp.toPx()
        translationY = topPx
        alpha = selectionOpacity()
      }.drawBackdrop(
        backdrop = selectedBackdrop,
        shape = { RoundedCornerShape(50) },
        effects = {
          val progress = pressProgress()
          if (officialMaterial) {
            lens((if (amPlusMaterial) refractionHeight * 10f / 24f else 10f).dp.toPx() * progress,
              (if (amPlusMaterial) refraction * 14f / 24f else 14f).dp.toPx() * progress,
              depthEffect = amPlusMaterial && depthEffect,
              chromaticAberration = if (amPlusMaterial && MaterialTuningMask.has(tuningMask, MaterialTuningMask.CHROMATIC)) chromaticAberration else true)
          } else {
            lens((refractionHeight * 10f / 14f).dp.toPx() * progress,
              refraction.dp.toPx() * progress,
              depthEffect = depthEffect, chromaticAberration = chromaticAberration)
          }
        },
        highlight = {
          if (officialMaterial && (tuningMask and (MaterialTuningMask.HIGHLIGHT_WIDTH or MaterialTuningMask.HIGHLIGHT_ALPHA)) == 0)
            Highlight.Default.copy(alpha = pressProgress())
          else Highlight(width = highlightWidth.dp, alpha = highlightOpacity * pressProgress())
        },
        shadow = { Shadow(alpha = pressProgress()) },
        innerShadow = { InnerShadow(radius = 8f.dp * pressProgress(), alpha = pressProgress()) },
        layerBlock = {
          val speed = velocity() / 10f
          scaleX = pressedScaleX() / (1f - (speed * 0.75f).coerceIn(-0.2f, 0.2f))
          scaleY = pressedScaleY() * (1f - (speed * 0.25f).coerceIn(-0.2f, 0.2f))
        },
        onDrawSurface = {
          val progress = pressProgress()
          drawRect((if (dark) Color.White else Color.Black).copy(alpha = 0.1f * (1f - progress)))
          drawRect(Color.Black.copy(alpha = 0.03f * progress))
        }
      )
    )
  }
}
