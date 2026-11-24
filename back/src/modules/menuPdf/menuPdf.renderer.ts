import {
  cleanPdfText as clean,
  contentWidth,
  createHotelPdf,
  Doc,
  drawBrandHeader,
  drawPageFooters,
  ensureSpace,
  PDF_COLORS as COLORS,
  PDF_FONTS as FONTS,
} from '../../common/hotelPdf';
import {
  formatDuration,
  formatPrice,
  MenuPdfContent,
  MenuPdfItem,
  MenuPdfSection,
} from './menuPdf.model';

const MARGINS = { top: 34, bottom: 52, left: 32, right: 32 };
const PRICE_GAP = 14;
const ITEM_GAP = 10;
const SECTION_HEADER_HEIGHT = 44;

const itemDetails = (item: MenuPdfItem): string =>
  [
    item.durationMinutes ? formatDuration(item.durationMinutes) : null,
    item.description ? clean(item.description) : null,
  ]
    .filter((part): part is string => !!part)
    .join(' · ');

export function renderMenuPdf(content: MenuPdfContent): Promise<Buffer> {
  return createHotelPdf(
    {
      size: 'A5',
      margins: MARGINS,
      info: {
        Title: `${content.title} · ${content.hotelName}`,
        Author: content.hotelName,
      },
    },
    (doc) => {
      drawBrandHeader(doc, {
        hotelName: content.hotelName,
        title: content.title,
        subtitles: [
          { text: content.schedule ?? '' },
          { text: content.note ?? '', italic: true },
        ],
      });
      content.sections.forEach((section) => drawSection(doc, section));
      drawPageFooters(
        doc,
        `${clean(content.hotelName)} · Actualización: ${content.updatedOn}`,
      );
    },
  );
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
