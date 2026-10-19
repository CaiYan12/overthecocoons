/** Keep the existing local artwork when a source image fails, including cached failures. */
function settleImage(image: HTMLImageElement): void {
  if (image.complete && image.naturalWidth === 0) image.hidden = true;
}

export function settleArticleImages(root: ParentNode = document): void {
  root.querySelectorAll<HTMLImageElement>("img[data-source-image]").forEach(settleImage);
}

export function initArticleImages(): void {
  document.addEventListener("error", event => {
    const image = event.target;
    if (image instanceof HTMLImageElement && image.hasAttribute("data-source-image")) image.hidden = true;
  }, true);
  settleArticleImages();
}
