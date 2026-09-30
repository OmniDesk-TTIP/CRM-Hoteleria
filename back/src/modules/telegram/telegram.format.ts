export const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Arma un link clickeable. La URL se escapa aparte porque va dentro de un atributo. */
export const htmlLink = (url: string, label: string): string =>
  `<a href="${escapeHtml(encodeURI(url))}">${escapeHtml(label)}</a>`;
