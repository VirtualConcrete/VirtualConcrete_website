# Virtual Concrete website

Single page (draft 3) from `../CLAUDE.md — Virtual Concrete Studio Spec.md` (architectural dark monograph):
its tokens, type, grid and copy. Static, no build step, no third-party requests.

Departures from the spec:
- no safety standards (section 04, sub-grid C); the section is "Technology & workflow";
- Italian only: no IT / EN switch;
- the page opens on the big "VIRTUAL CONCRETE STUDIO" title of the first site, in Inter, full
  screen and above the bar (the hero keeps only its copy). Scrolling lifts the title off a
  cellular automaton: Conway's Life on a 12px grid, seeded from the title's own letters, that
  steps only while the page is scrolled and the opening is in view (`CA` at the top of that part of
  site.js). The spec's "no canvas" check is waived for it;
- after the automaton, "Spatial design & tecnologie illuminotecniche applicate" (the h1), full screen
  like the title, slides up over it; both come before the bar;
- the hero is a view of its own: the copy on the left (the lead promoted to its headline), on the
  right a 64x128 LED screen, the first site's title panel turned portrait, with a one-dimensional
  cellular automaton (rule 30) printing a row at the bottom and scrolling up (`CA` and `LOOK` at the
  top of `screen.js`; the screen's black is `--bg-canvas`);
- the DumBO plates show their colours and notes only while the mouse moves (as in draft 2).

Sans headings are in sentence case (in capitals, "ILLUMINOTECNICHE" doesn't fit columns 1–5 at the
spec's H1 size); capitals are kept for the mono labels.

```
index.html
favicon.svg
assets/
  css/site.css        the spec's tokens at the top (:root), breakpoints at the bottom
  js/site.js          nav, the opening's automaton, image placeholders, the DumBO stage, the form
  js/screen.js        the hero's 64x128 LED screen (ported from the first site's assets/tui)
  plates/zoom-0N.svg  DumBO CAD plates, made by ../tools/plate2svg.py (don't edit by hand)
  img/dumbo.avif|webp render and Tavola 0-B: unused on the home page, kept for the DumBO project page
  video/link2.mp4     Link 2.0 (02.2): the first site's hero.mp4, from M25-0002_V2-0029.mov
  video/link2-poster.webp  its frame 37
  fonts/              Inter (variable) + JetBrains Mono, subset, SIL OFL 1.1
```

## Link 2.0 video

`assets/video/link2.mp4` is made from the master `M25-0002_V2-0029.mov` (DNxHR, kept outside the repo):

```sh
ffmpeg -i M25-0002_V2-0029.mov -map 0:v:0 -an -dn -map_metadata -1 \
  -vf "scale=1920:1080:flags=lanczos+accurate_rnd+full_chroma_int:in_range=pc:out_range=tv:sws_dither=ed,format=yuv420p" \
  -c:v libx264 -preset veryslow -crf 21 -profile:v high -tune film -x264-params aq-mode=3:aq-strength=0.9 \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv -movflags +faststart \
  assets/video/link2.mp4
```

The footage is dark haze, which bands easily: `aq-mode=3` and the dither keep the gradients smooth.

## Preview

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Over `file://` the plates don't load as drawings: serve it.

## Images still to come

Drop them in `assets/img/` with these names (16:9, about 1600×900, WebP at 82–85%) and they replace
the placeholders by themselves:

- `exdynamo.webp` — Ex Dynamo
- `galvo-uv.webp` — Galvo UV

For an AVIF next to it, wrap the `<img>` in a `<picture>` with a `<source type="image/avif">`, as the
DumBO render does. From any image:

```sh
ffmpeg -i in.png -vf "scale=1600:900:force_original_aspect_ratio=increase,crop=1600:900" -quality 84 assets/img/link2.webp
ffmpeg -i assets/img/link2.webp -c:v libaom-av1 -still-picture 1 -crf 24 assets/img/link2.avif
```

The technical dossier goes at `assets/docs/virtual-concrete-technical-dossier.pdf`.

## DumBO stage

At rest: the render in greyscale, the plates as grey drawings. While the mouse moves over them
(a tap on phones, focus with the keyboard) the colours come back; on the plates also the callouts,
legend, title block and a crosshair with the drawing's coordinates. Nothing is written over the
render. The callouts are kept at 12–13px on screen (`--u` in site.js).

A new plate:

```sh
python3 tools/plate2svg.py media/DumBO/ZOOM_3_Dettagliato.html VirtualConcrete_website/assets/plates/zoom-03.svg
```

then copy a `<figure class="frame">` and a tab in `index.html`.

## Form

Set `data-endpoint` on `#contact-form` to Giovanni's endpoint; until then submitting says it isn't
configured. It POSTs FormData: `name`, `email`, `sector`, `type`, `area_sqm`, `notes`, and `website`
(the honeypot: left empty by people).

## The first site

The previous version (LED title panel, DumBO laser simulation, project pages, NCA) is commit
`bac4a4c`, and a copy sits in `../draft_1`.
