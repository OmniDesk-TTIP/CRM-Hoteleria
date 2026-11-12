// eslint-disable-next-line @typescript-eslint/no-require-imports -- pdfkit se exporta con `export =`
import PDFDocument = require('pdfkit');
import {
  formatDuration,
  formatPrice,
  MenuPdfContent,
  MenuPdfItem,
  MenuPdfSection,
} from './menuPdf.model';

type Doc = PDFKit.PDFDocument;

const COLORS = {
  background: '#14110f',
  text: '#ece3d7',
  muted: '#a8998a',
  accent: '#c8a27a',
};

const FONTS = {
  display: 'Times-Roman',
  displayBold: 'Times-Bold',
  displayItalic: 'Times-Italic',
  body: 'Helvetica',
  bodyBold: 'Helvetica-Bold',
};

const MARGINS = { top: 34, bottom: 52, left: 32, right: 32 };
const LOGO_RADIUS = 17;
const PRICE_GAP = 14;
const ITEM_GAP = 10;
const SECTION_HEADER_HEIGHT = 44;

const EXTRA_GLYPHS = '–—…•’‘“”';

const isDrawable = (char: string): boolean => {
  const code = char.charCodeAt(0);
  return (
    (code >= 0x20 && code <= 0x7e) ||
    (code >= 0xa0 && code <= 0xff) ||
    EXTRA_GLYPHS.includes(char)
  );
};

const clean = (text: string): string =>
  [...text.split(/\s+/).join(' ')].filter(isDrawable).join('').trim();

const contentWidth = (doc: Doc): number =>
  doc.page.width - doc.page.margins.left - doc.page.margins.right;

const itemDetails = (item: MenuPdfItem): string =>
  [
    item.durationMinutes ? formatDuration(item.durationMinutes) : null,
    item.description ? clean(item.description) : null,
  ]
    .filter((part): part is string => !!part)
    .join(' · ');

export function renderMenuPdf(content: MenuPdfContent): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A5',
      margins: MARGINS,
      bufferPages: true,
      info: {
        Title: `${content.title} · ${content.hotelName}`,
        Author: content.hotelName,
      },
    });
    const buffers: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);
    doc.on('pageAdded', () => paintBackground(doc));

    paintBackground(doc);
    drawHeader(doc, content);
    content.sections.forEach((section) => drawSection(doc, section));
    drawFooters(doc, content);

    doc.end();
  });
}

function paintBackground(doc: Doc): void {
  doc
    .save()
    .rect(0, 0, doc.page.width, doc.page.height)
    .fill(COLORS.background)
    .restore();
}

function drawHeader(doc: Doc, content: MenuPdfContent): void {
  const { left, top } = doc.page.margins;
  const width = contentWidth(doc);
  const centerX = doc.page.width / 2;
  const centered = { width, align: 'center' as const };
  const hotelName = clean(content.hotelName);

  doc
    .circle(centerX, top + LOGO_RADIUS, LOGO_RADIUS)
    .lineWidth(0.8)
    .stroke(COLORS.accent);
  doc
    .font(FONTS.display)
    .fontSize(20)
    .fillColor(COLORS.text)
    .text(hotelName.charAt(0).toUpperCase(), left, top + 7.5, centered);

  doc
    .font(FONTS.body)
    .fontSize(8)
    .fillColor(COLORS.accent)
    .text(hotelName.toUpperCase(), left, top + LOGO_RADIUS * 2 + 10, {
      ...centered,
      characterSpacing: 3,
    });

  doc
    .moveDown(1.4)
    .font(FONTS.display)
    .fontSize(27)
    .fillColor(COLORS.text)
    .text(content.title, centered);

  const subtitles = [
    { text: content.schedule, font: FONTS.body },
    { text: content.note, font: FONTS.displayItalic },
  ].filter((line): line is { text: string; font: string } => !!line.text);
  subtitles.forEach((line) =>
    doc
      .moveDown(0.35)
      .font(line.font)
      .fontSize(9)
      .fillColor(COLORS.muted)
      .text(clean(line.text), centered),
  );

  const ruleY = doc.y + 12;
  doc
    .moveTo(centerX - 20, ruleY)
    .lineTo(centerX + 20, ruleY)
    .lineWidth(0.8)
    .stroke(COLORS.accent);
  doc.y = ruleY + 6;
}

function drawSection(doc: Doc, section: MenuPdfSection): void {
  ensureSpace(doc, SECTION_HEADER_HEIGHT + itemHeight(doc, section.items[0]));

  const { left } = doc.page.margins;
  const width = contentWidth(doc);
  doc
    .font(FONTS.body)
    .fontSize(9)
    .fillColor(COLORS.accent)
    .text(clean(section.category).toUpperCase(), left, doc.y + 16, {
      width,
      characterSpacing: 2.5,
    });

  const ruleY = doc.y + 4;
  doc
    .save()
    .moveTo(left, ruleY)
    .lineTo(left + width, ruleY)
    .lineWidth(0.5)
    .strokeOpacity(0.45)
    .stroke(COLORS.accent)
    .restore();
  doc.y = ruleY + 11;

  section.items.forEach((item) => drawItem(doc, item));
}

function drawItem(doc: Doc, item: MenuPdfItem): void {
  ensureSpace(doc, itemHeight(doc, item));

  const { left } = doc.page.margins;
  const width = contentWidth(doc);
  const top = doc.y;
  const price = formatPrice(item.price);

  doc.font(FONTS.bodyBold).fontSize(10).fillColor(COLORS.accent);
  const nameWidth = width - doc.widthOfString(price) - PRICE_GAP;
  doc.text(price, left, top + 2, { width, align: 'right' });

  doc
    .font(FONTS.displayBold)
    .fontSize(12.5)
    .fillColor(COLORS.text)
    .text(clean(item.name), left, top, { width: nameWidth });

  const details = itemDetails(item);
  if (details) {
    doc
      .font(FONTS.body)
      .fontSize(9)
      .fillColor(COLORS.muted)
      .text(details, left, doc.y + 2, { width: nameWidth, lineGap: 1.5 });
  }

  doc.y += ITEM_GAP;
}

function itemHeight(doc: Doc, item: MenuPdfItem): number {
  const price = formatPrice(item.price);
  const nameWidth =
    contentWidth(doc) -
    doc.font(FONTS.bodyBold).fontSize(10).widthOfString(price) -
    PRICE_GAP;

  const nameHeight = doc
    .font(FONTS.displayBold)
    .fontSize(12.5)
    .heightOfString(clean(item.name), { width: nameWidth });
  const details = itemDetails(item);
  const detailsHeight = details
    ? 2 +
      doc
        .font(FONTS.body)
        .fontSize(9)
        .heightOfString(details, { width: nameWidth, lineGap: 1.5 })
    : 0;

  return nameHeight + detailsHeight + ITEM_GAP;
}

function ensureSpace(doc: Doc, height: number): void {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + height > bottom) doc.addPage();
}

function drawFooters(doc: Doc, content: MenuPdfContent): void {
  const { count } = doc.bufferedPageRange();
  const base = `${clean(content.hotelName)} · Actualización: ${content.updatedOn}`;

  for (let page = 0; page < count; page++) {
    doc.switchToPage(page);
    doc.page.margins.bottom = 0;
    doc
      .font(FONTS.body)
      .fontSize(7.5)
      .fillColor(COLORS.muted)
      .text(
        count > 1 ? `${base} · ${page + 1}/${count}` : base,
        doc.page.margins.left,
        doc.page.height - 30,
        { width: contentWidth(doc), align: 'center' },
      );
  }
}
