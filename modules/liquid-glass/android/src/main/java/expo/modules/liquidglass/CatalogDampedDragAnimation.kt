/*
 * Adapted from Kyant0/AndroidLiquidGlass (65ab177), Copyright 2025 Kyant.
 * Apache-2.0; see ANDROID_LIQUID_GLASS_LICENSE. Modified for Expo integration
 * and cancellation-safe gestures; all catalog spring/material defaults retained.
 * Job/generation cleanup adapted from AM++ commit97fa2e4 (GPL-3.0);
 * see THIRD_PARTY_NOTICES.md. Original Kyant sections remain Apache-2.0.
 */
package expo.modules.liquidglass

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.unit.IntSize
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlin.math.abs
import android.os.SystemClock
import kotlinx.coroutines.android.awaitFrame

class DampedDragAnimation(
    private val animationScope: CoroutineScope,
    val initialValue: Float,
    val valueRange: ClosedRange<Float>,
    val visibilityThreshold: Float,
    val initialScale: Float,
    val pressedScale: Float,
    val onDragStarted: DampedDragAnimation.(position: Offset) -> Unit,
    val onDragStopped: DampedDragAnimation.() -> Unit,
    val onDrag: DampedDragAnimation.(size: IntSize, dragAmount: Offset) -> Unit,
    val onDragCancelled: DampedDragAnimation.() -> Unit = {},
) {

    private val valueAnimationSpec =
        spring(1f, 1000f, visibilityThreshold)
    private val velocityAnimationSpec =
        spring(0.5f, 300f, visibilityThreshold * 10f)
    private val pressProgressAnimationSpec =
        spring(1f, 1000f, 0.001f)
    private val scaleXAnimationSpec =
        spring(0.6f, 250f, 0.001f)
    private val scaleYAnimationSpec =
        spring(0.7f, 250f, 0.001f)

    private val valueAnimation =
        Animatable(initialValue, visibilityThreshold)
    private val velocityAnimation =
        Animatable(0f, 5f)
    private val pressProgressAnimation =
        Animatable(0f, 0.001f)
    private val scaleXAnimation =
        Animatable(initialScale, 0.001f)
    private val scaleYAnimation =
        Animatable(initialScale, 0.001f)

    private var motionJob: Job? = null
    private var velocityJob: Job? = null
    private var pressJob: Job? = null
    private var releaseJob: Job? = null
    private val velocityGeneration = CatalogMotionGeneration()

    private val velocityTracker = VelocityTracker()

    val value: Float get() = valueAnimation.value
    val progress: Float get() = (value - valueRange.start) / (valueRange.endInclusive - valueRange.start)
    val targetValue: Float get() = valueAnimation.targetValue
    val pressProgress: Float get() = pressProgressAnimation.value
    val scaleX: Float get() = scaleXAnimation.value
    val scaleY: Float get() = scaleYAnimation.value
    val velocity: Float get() = velocityAnimation.value

    // Expo can replace a slider's range when the current song changes. Keep
    // the pointer coroutine tied to this animation, rather than an old range.
    val modifier: Modifier = Modifier.pointerInput(this@DampedDragAnimation) {
        inspectDragGestures(
            onDragStart = { down ->
                onDragStarted(down.position)
                press()
            },
            onDragEnd = {
                onDragStopped()
                release()
            },
            onDragCancel = {
                onDragCancelled()
                release()
            }
        ) { change, dragAmount ->
            onDrag(size, dragAmount)
        }
    }

    fun press() {
        releaseJob?.cancel()
        pressJob?.cancel()
        val generation = velocityGeneration.advance()
        velocityJob?.cancel()
        velocityTracker.resetTracking()
        velocityJob = animationScope.launch {
            if (velocityGeneration.accepts(generation)) resetVelocity()
        }
        pressJob = animationScope.launch {
            launch { pressProgressAnimation.animateTo(1f, pressProgressAnimationSpec) }
            launch { scaleXAnimation.animateTo(pressedScale, scaleXAnimationSpec) }
            launch { scaleYAnimation.animateTo(pressedScale, scaleYAnimationSpec) }
        }
    }

    fun release() {
        releaseJob?.cancel()
        releaseJob = animationScope.launch {
            awaitFrame()
            if (value != targetValue) {
                val threshold = (valueRange.endInclusive - valueRange.start) * 0.025f
                snapshotFlow { abs(valueAnimation.value - valueAnimation.targetValue) }
                    .first { it < threshold }
            }
            // A released control must not keep the velocity from its last drag
            // frame. Invalidate queued writes before restoring the idle shape.
            velocityGeneration.advance()
            velocityJob?.cancelAndJoin()
            pressJob?.cancelAndJoin()
            coroutineScope {
                launch { resetVelocity() }
                launch {
                    pressProgressAnimation.animateTo(0f, pressProgressAnimationSpec)
                    pressProgressAnimation.snapTo(0f)
                }
                launch {
                    scaleXAnimation.animateTo(initialScale, scaleXAnimationSpec)
                    scaleXAnimation.snapTo(initialScale)
                }
                launch {
                    scaleYAnimation.animateTo(initialScale, scaleYAnimationSpec)
                    scaleYAnimation.snapTo(initialScale)
                }
            }
        }
    }

    fun updateValue(value: Float) {
        val targetValue = value.coerceIn(valueRange)
        val generation = velocityGeneration.current
        motionJob = animationScope.launch {
            // Animatable retargets the running spring. Cancelling on each tiny
            // move instead would throw away its frame time and velocity.
            if (velocityGeneration.accepts(generation)) {
                valueAnimation.animateTo(targetValue, valueAnimationSpec) { updateVelocity(generation) }
            }
        }
    }

    fun animateToValue(value: Float) {
        val targetValue = value.coerceIn(valueRange)
        velocityGeneration.advance()
        motionJob?.cancel()
        velocityJob?.cancel()
        press()
        motionJob = animationScope.launch {
            coroutineScope {
                launch { valueAnimation.animateTo(targetValue, valueAnimationSpec) }
                launch { resetVelocity() }
            }
        }
        release()
    }

    private suspend fun resetVelocity() {
        velocityAnimation.animateTo(0f, velocityAnimationSpec)
        velocityAnimation.snapTo(0f)
    }

    private fun updateVelocity(generation: Int) {
        if (!velocityGeneration.accepts(generation)) return
        velocityTracker.addPosition(SystemClock.uptimeMillis(), Offset(value, 0f))
        val targetVelocity = velocityTracker.calculateVelocity().x / (valueRange.endInclusive - valueRange.start)
        velocityJob = animationScope.launch {
            if (velocityGeneration.accepts(generation)) {
                velocityAnimation.animateTo(targetVelocity, velocityAnimationSpec)
            }
        }
    }
}
