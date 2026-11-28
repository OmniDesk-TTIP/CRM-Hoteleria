// eslint-disable-next-line @typescript-eslint/no-require-imports -- pdfkit se exporta con `export =`
import PDFDocument = require('pdfkit');

/**
 * Diseño común de los PDF del hotel (US-25): fondo oscuro, tipografías clásicas, el logo con la
 * inicial y el nombre del hotel arriba, y un pie centrado en cada página. Lo usan las cartas y el
 * estado de cuenta (US-28), así todos los documentos se ven iguales.
 */
export type Doc = PDFKit.PDFDocument;

export const DEFAULT_HOTEL_NAME = 'Alma Hotel';

export const PDF_COLORS = {
  background: '#14110f',
  text: '#ece3d7',
  muted: '#a8998a',
  accent: '#c8a27a',
};

export const PDF_FONTS = {
  display: 'Times-Roman',
  displayBold: 'Times-Bold',
  displayItalic: 'Times-Italic',
  body: 'Helvetica',
  bodyBold: 'Helvetica-Bold',
};

const LOGO_RADIUS = 17;

// las fuentes estándar de PDF solo traen Latin-1: el resto (emojis, otros alfabetos) se descarta
const EXTRA_GLYPHS = '–—…•’‘“”';

const isDrawable = (char: string): boolean => {
  const code = char.charCodeAt(0);
  return (
    (code >= 0x20 && code <= 0x7e) ||
    (code >= 0xa0 && code <= 0xff) ||
    EXTRA_GLYPHS.includes(char)
  );
};

/** Texto en una sola línea y solo con caracteres que las fuentes del PDF pueden dibujar. */
export const cleanPdfText = (text: string): string =>
  [...text.split(/\s+/).join(' ')].filter(isDrawable).join('').trim();

export const contentWidth = (doc: Doc): number =>
  doc.page.width - doc.page.margins.left - doc.page.margins.right;

/** Crea el documento con el fondo del hotel en todas las páginas y junta el resultado en un Buffer. */
export function createHotelPdf(
  options: PDFKit.PDFDocumentOptions,
  draw: (doc: Doc) => void,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ ...options, bufferPages: true });
    const buffers: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);
    doc.on('pageAdded', () => paintBackground(doc));

    paintBackground(doc);
    draw(doc);
    doc.end();
  });
}

function paintBackground(doc: Doc): void {
  doc
    .save()
    .rect(0, 0, doc.page.width, doc.page.height)
    .fill(PDF_COLORS.background)
    .restore();
}

export interface PdfSubtitle {
  text: string;
  italic?: boolean;
}

/** Logo con la inicial, nombre del hotel, título y subtítulos centrados, y una línea dorada. */
export function drawBrandHeader(
  doc: Doc,
  header: { hotelName: string; title: string; subtitles: PdfSubtitle[] },
): void {
  const { left, top } = doc.page.margins;
  const width = contentWidth(doc);
  const centerX = doc.page.width / 2;
  const centered = { width, align: 'center' as const };
  const hotelName = cleanPdfText(header.hotelName);

  doc
    .circle(centerX, top + LOGO_RADIUS, LOGO_RADIUS)
    .lineWidth(0.8)
    .stroke(PDF_COLORS.accent);
  doc
    .font(PDF_FONTS.display)
    .fontSize(20)
    .fillColor(PDF_COLORS.text)
    .text(hotelName.charAt(0).toUpperCase(), left, top + 7.5, centered);

  doc
    .font(PDF_FONTS.body)
    .fontSize(8)
    .fillColor(PDF_COLORS.accent)
    .text(hotelName.toUpperCase(), left, top + LOGO_RADIUS * 2 + 10, {
      ...centered,
      characterSpacing: 3,
    });

  doc
    .moveDown(1.4)
    .font(PDF_FONTS.display)
    .fontSize(27)
    .fillColor(PDF_COLORS.text)
    .text(header.title, centered);

  header.subtitles
    .filter((line) => line.text)
    .forEach((line) =>
      doc
        .moveDown(0.35)
        .font(line.italic ? PDF_FONTS.displayItalic : PDF_FONTS.body)
        .fontSize(9)
        .fillColor(PDF_COLORS.muted)
        .text(cleanPdfText(line.text), centered),
    );

  const ruleY = doc.y + 12;
  doc
    .moveTo(centerX - 20, ruleY)
    .lineTo(centerX + 20, ruleY)
    .lineWidth(0.8)
    .stroke(PDF_COLORS.accent);
  doc.y = ruleY + 6;
}

/** Pasa a una página nueva si lo que sigue no entra en la actual. */
export function ensureSpace(doc: Doc, height: number): void {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + height > bottom) doc.addPage();
}

/** Pie centrado en todas las páginas, con el número de página si hay más de una. */
export function drawPageFooters(doc: Doc, text: string): void {
  const { count } = doc.bufferedPageRange();
  for (let page = 0; page < count; page++) {
    doc.switchToPage(page);
    doc.page.margins.bottom = 0;
    doc
      .font(PDF_FONTS.body)
      .fontSize(7.5)
      .fillColor(PDF_COLORS.muted)
      .text(
        count > 1 ? `${text} · ${page + 1}/${count}` : text,
        doc.page.margins.left,
        doc.page.height - 30,
        { width: contentWidth(doc), align: 'center' },
      );
  }
}
