# Local PageFlip fix

`page-flip.browser.min.js`: `HTMLPage.newTemporaryCopy()` copies canvas pixels
with `drawImage` after cloning the page, and removes duplicate IDs from the clone.
Native `cloneNode(true)` copies canvas dimensions but not the bitmap. Portrait
animations otherwise show a blank temporary page and duplicate canvas IDs can
send PDF rendering to the temporary copy. Keep this patch when replacing the library.

`UI.cancelTouch()` clears pending single-finger gestures when starting a pinch or
receiving `touchcancel`. This also cancels the delayed touch-start timer's effect,
so finishing a pinch cannot accidentally turn a page on a large touch display.

`Flip.flip()` and `fold()` ignore attempts to interrupt an active flip. Before
creating a flip, `start()` calls the optional `app.beforeFlip(direction, indices,
inputKind)` readiness hook. A failed readiness check leaves the current spread
visible instead of animating blank pages.

`Render.stop()` cancels its animation frame, and `PageFlip.destroy()` calls it.
Destroyed books must not leave permanent rendering loops after window resizes.
`UI.destroy()` always removes its resize handler, including when native input
handlers are disabled in favor of the viewer's unified Pointer Events control.
