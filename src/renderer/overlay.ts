interface PickerApi {
  pick(x: number, y: number): void;
  cancel(): void;
}
declare const picker: PickerApi;

(() => {
  const hint = document.getElementById('hint') as HTMLDivElement;

  // The hint pill follows the cursor.
  document.addEventListener('mousemove', (e) => {
    hint.hidden = false;
    hint.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 16}px)`;
  });
  document.addEventListener('mouseleave', () => (hint.hidden = true));

  // Left click picks the spot (in this window's coordinates; main adds the window offset). Anything else cancels.
  document.addEventListener('pointerdown', (e) => {
    if (e.button === 0) picker.pick(e.clientX, e.clientY);
    else picker.cancel();
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') picker.cancel();
  });
})();
