# Cellwork Pattern Generator

A generative pattern generator for publishing assets. Pick a pattern, tune it, and export it as a still or a seamless loop.

## Features

- **Seven generators:** Waves, Ripples, Noise Field, Spiral, Stripes, Rain Drops and Clifford Attractor, each with seed, scale, detail and distortion.
- **Cell styles:** dots, squares, bars, crosses or glyphs, with spacing, size, shades, threshold and texture.
- **Motion:** Off, or On for a seamless 2–12 s loop.
- **Appearance:** dark or light tone, colour swatches or a custom colour, opacity and film grain.
- **Text overlay:** optional label, headline and subtitle in Sans, Mono or Pixel type, top, centre or bottom.
- **Formats:** 16:9, square, 4:5, 9:16, link preview (1200×630) and banner (3:1).

## Export

| Format | Best for | Notes |
| --- | --- | --- |
| PNG | Web and social stills | 1× or 2× |
| SVG | Print or editing in design tools | Vector; grain isn't included |
| Video (MP4) | Motion | 1080p, 30 fps, via WebCodecs; falls back to WebM |
| GIF | Places that don't take video | 720 px, 20 fps; set Grain to 0 for smaller files |

## How it works

Everything lives in `index.html`: no build step, no server. Each generator returns a value from 0 to 1 for every cell in a grid; that value sets the cell's size and shade. All motion uses whole cycles of one loop phase, so exported loops repeat seamlessly.

The GIF encoder ([gifenc](https://github.com/mattdesl/gifenc)) and MP4 muxer ([mp4-muxer](https://github.com/Vanilagy/mp4-muxer)) load from jsDelivr only when you export.

## Run locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.
