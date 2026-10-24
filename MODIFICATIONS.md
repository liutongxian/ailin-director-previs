# Modifications to Blockout

- 2026-10-24: Add optional contextual bubble tours for the built-in sample, external-Agent director packages, real white-model video export, and manual staging/camera work. Bundle the existing generic JSON sample in the renderer; preserve dirty projects before opening a separate practice project; track real completion, dismissal and local resume state; reposition bubbles on scroll/resize. Give every new demo a unique folder, keep asset placement when a guide stays on the same page, explain encoder failures, and allow launcher-specific profile/project paths without touching older installations. No commercial licensing, cloud generation, private projects, or new runtime dependencies are introduced.

This repository is a derivative of Sam Wasserman's Blockout, licensed under
Apache-2.0. The original copyright and attribution remain in `LICENSE` and
`NOTICE`.

The 艾琳导演台 open-core edition adds a Chinese/English director interface,
editable storyboard and director-package staging, deterministic camera and
performer blocking, local project persistence, and a Blender white-model
pipeline that exports an MP4, a `.blend` file, and key-frame check images.
It also includes Three.js viewport previs export, an MCP/CLI local control
bridge, and generic Previs IR examples.

This public source snapshot excludes commercial activation, seller tools,
hosted model integrations, private projects, and licensed distribution
artifacts. It is intended to run locally from source with separately installed
Blender and FFmpeg; no Blender or FFmpeg binaries are included.

The complete implementation history is not included because this is an
independent public source snapshot. See the upstream Blockout project and
`NOTICE` for the original author credit.

## 2026-10-20 · v0.2.3

The home screen now offers only two starting paths: director-package previs
and manual staging. Editing, camera and export tools appear inside the
workspace. The director-package workspace no longer exposes the separate
TXT/MD recognition and Previs IR import controls. Existing projects, source
formats and local export engines remain compatible. Commercial source,
activation and distribution packages are unchanged and excluded.
