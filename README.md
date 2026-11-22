# Virtual Concrete website

Static showcase site: no build step, no dependencies to install, no third-party requests.

```
index.html      landing page
assets/         landing styles and images
  tui/          the hero: a simulated 128x64 LED panel
                terminal.js  what the panel shows, ported from the auto_text firmware but
                             typed letter by letter, once; timing at the top
                panel.js     the panel on a canvas, and typing on it
                screen.js    the hero: types, then scrolls
                scroll.js    scrolling the panel one LED per step; knobs at the top
                leds.js      how the lit LEDs look; tuning knobs in LOOK at the top
                leds-2d.js   fallback without WebGL 2
                font.js      the firmware's 10x20, for the typed phrase
                font-8x16.js smaller, for the phrase scrolled to
                fonts: Terminus Bold subsets (SIL OFL 1.1)
dumbo/          DumBO laser simulation (three.js)
  assets/       generated from the Blender project, don't edit by hand
  lib/three/    three.js r180 (MIT) and Draco decoder (Apache-2.0)
exdynamo/       project pages, styled by assets/site.css;
galvoscanners/  thumbnails in assets/img/<folder name>.webp
link2/
nca/            not linked: the title alone, erased by dragging and grown back by a
                neural cellular automaton (assets/tui/nca*.js, trained by ../nca/train.py)
```

## Change the hero text

Edit `<h1 id="screen-text">` (typed once) and `<p id="screen-text-next">` (scrolled to afterwards)
in `index.html`. The first fits 12 characters x 3 lines, the second 16 x 4; longer text wraps and
hyphenates.
The scroll gets longer by itself when the second needs more: 16 steps per extra line.

## Hero video

`assets/video/hero.mp4` is made from the master `M25-0002_V2-0029.mov` (DNxHR, kept outside the repo):

```sh
ffmpeg -i M25-0002_V2-0029.mov -map 0:v:0 -an -dn -map_metadata -1 \
  -vf "scale=1920:1080:flags=lanczos+accurate_rnd+full_chroma_int:in_range=pc:out_range=tv:sws_dither=ed,format=yuv420p" \
  -c:v libx264 -preset veryslow -crf 21 -profile:v high -tune film -x264-params aq-mode=3:aq-strength=0.9 \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv -movflags +faststart \
  assets/video/hero.mp4
```

The footage is dark haze, which bands easily: `aq-mode=3` and the dither keep the gradients smooth.
Lower `-crf` for quality, raise it for size.

## Preview

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

All paths are relative, so it works at a domain root or in a subfolder.

## DumBO URL options

`?show=sweep` · `?view=1|2|3` · `?t=3.5` (paused) · `?quality=high|low` · `?clean` (no interface)
