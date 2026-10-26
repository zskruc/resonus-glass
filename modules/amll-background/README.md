# Native artwork field / 原生封面流体背景

Visual reference: [AMLL](https://github.com/amll-dev/applemusic-like-lyrics) at
`5fee356362353dbb24ce9bea3a62536478040de7`, especially its Mesh background and
`react-full` player. AMLL is AGPL-3.0-only and is **not embedded or imported**.
This module is an independently written native interpretation under this
repository's GPL-3.0-or-later license. It does not contain AMLL's source, shaders,
Bézier control-point presets, SVGs, or animation engine. Its sinusoidal mesh and
BT.709 color matrix differ from AMLL's implementation; it is not a pixel-identical
port or an implementation of Apple's private rendering algorithms.

视觉参考为上述固定版本的 AMLL Mesh 背景；本模块独立编写，使用本仓库的
GPL-3.0-or-later 许可，不包含 AMLL 代码、着色器、控制点预设或资源。

The common functional treatment is a 32×32 artwork texture, contrast/saturation/
brightness shaping (0.4 / 3 / 1.7 / 0.75), soft blur, broad moving color areas,
and a vignette. The complete artwork supplies the spatial color distribution;
it is not replaced by a single dominant-color gradient.

- Only Expo Image resolves/downloads artwork. Native code accepts local files
  and content URIs and never opens an HTTP connection.
- Decode, color shaping and blur run once on a serial worker, with an 8-texture
  LRU. Canceled generations cannot replace newer artwork.
- One mutable drawing buffer has a maximum 256-pixel edge. The same bitmap,
  Canvas, vertex array and paints are reused; there is no full-screen readback,
  backdrop capture, per-frame bitmap allocation, or full-screen blur.
- A separate 60fps maximum budget applies to this slowly moving field only.
  No display/surface refresh-rate request is changed. UI animation may run at
  120Hz independently.
- Paused, hidden, detached, backgrounded, or missing-art views do not schedule
  animation frames. Resuming preserves the phase rather than jumping ahead.
