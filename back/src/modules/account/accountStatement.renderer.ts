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
import { AccountStatement, StatementRow } from './accountStatement.model';

const MARGINS = { top: 40, bottom: 56, left: 48, right: 48 };
const ROW_GAP = 7;
const FONT_SIZE = 9;

/** Anchos fijos de fecha, origen y monto: el detalle se queda con el resto. */
const COLUMNS = { date: 86, origin: 74, amount: 88, gap: 10 };

interface ColumnLayout {
  date: number;
  detail: number;
  detailWidth: number;
  origin: number;
  amount: number;
}

function layout(doc: Doc): ColumnLayout {
  const { left } = doc.page.margins;
  const width = contentWidth(doc);
  const detailWidth =
    width - COLUMNS.date - COLUMNS.origin - COLUMNS.amount - COLUMNS.gap * 3;
  const detail = left + COLUMNS.date + COLUMNS.gap;
  const origin = detail + detailWidth + COLUMNS.gap;
  return {
    date: left,
    detail,
    detailWidth,
    origin,
    amount: origin + COLUMNS.origin + COLUMNS.gap,
  };
}

/** US-30: dibuja el estado de cuenta con el diseño de los PDF del hotel (US-25). */
export function renderAccountStatement(
  statement: AccountStatement,
): Promise<Buffer> {
  return createHotelPdf(
    {
      size: 'A4',
      margins: MARGINS,
      info: {
        Title: `${statement.title} · ${statement.hotelName}`,
        Author: statement.hotelName,
      },
    },
    (doc) => {
      drawBrandHeader(doc, {
        hotelName: statement.hotelName,
        title: statement.title,
        subtitles: [{ text: statement.legalNote, italic: true }],
      });
      drawDetails(doc, statement);
      drawEntries(doc, statement.rows);
      drawTotals(doc, statement);
      drawPageFooters(
        doc,
        `${clean(statement.hotelName)} · ${statement.legalNote} · Emitido el ${statement.issuedAt}`,
      );
    },
  );
}

function drawDetails(doc: Doc, statement: AccountStatement): void {
  const { left } = doc.page.margins;
  const labelWidth = 80;
  doc.y += 14;
  statement.details.forEach(({ label, value }) => {
    const top = doc.y;
    doc
      .font(FONTS.body)
      .fontSize(FONT_SIZE)
      .fillColor(COLORS.muted)
      .text(label.toUpperCase(), left, top, {
        width: labelWidth,
        characterSpacing: 1,
      });
    doc
      .font(FONTS.bodyBold)
      .fontSize(FONT_SIZE + 1)
      .fillColor(COLORS.text)
      .text(clean(value), left + labelWidth, top - 0.5, {
        width: contentWidth(doc) - labelWidth,
      });
    doc.y += 3;
  });
}

function drawTableHeader(doc: Doc): void {
  const columns = layout(doc);
  const top = doc.y;
  doc.font(FONTS.body).fontSize(7.5).fillColor(COLORS.accent);
  const header = { characterSpacing: 1.5 };
  doc.text('FECHA', columns.date, top, { ...header, width: COLUMNS.date });
  doc.text('DETALLE', columns.detail, top, {
    ...header,
    width: columns.detailWidth,
  });
  doc.text('ORIGEN', columns.origin, top, {
    ...header,
    width: COLUMNS.origin,
  });
  doc.text('MONTO', columns.amount, top, {
    ...header,
    width: COLUMNS.amount,
    align: 'right',
  });

  const ruleY = doc.y + 4;
  doc
    .save()
    .moveTo(doc.page.margins.left, ruleY)
    .lineTo(doc.page.margins.left + contentWidth(doc), ruleY)
    .lineWidth(0.5)
    .strokeOpacity(0.45)
    .stroke(COLORS.accent)
    .restore();
  doc.y = ruleY + 8;
}

function rowHeight(doc: Doc, row: StatementRow): number {
  const { detailWidth } = layout(doc);
  return (
    doc
      .font(FONTS.body)
      .fontSize(FONT_SIZE)
      .heightOfString(rowDetail(row), { width: detailWidth }) + ROW_GAP
  );
}

const rowDetail = (row: StatementRow): string =>
  clean(row.reversed ? `${row.detail} (anulado)` : row.detail);

function drawEntries(doc: Doc, rows: StatementRow[]): void {
  doc.y += 18;
  ensureSpace(doc, 40);
  drawTableHeader(doc);

  if (rows.length === 0) {
    doc
      .font(FONTS.displayItalic)
      .fontSize(FONT_SIZE + 1)
      .fillColor(COLORS.muted)
      .text('La cuenta no tiene movimientos.', doc.page.margins.left, doc.y, {
        width: contentWidth(doc),
        align: 'center',
      });
    return;
  }

  rows.forEach((row) => {
    const height = rowHeight(doc, row);
    if (doc.y + height > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      // en cada página nueva se repite el encabezado de la tabla
      drawTableHeader(doc);
    }
    drawRow(doc, row);
  });
}

function drawRow(doc: Doc, row: StatementRow): void {
  const columns = layout(doc);
  const top = doc.y;
  const color = row.reversed || row.isReversal ? COLORS.muted : COLORS.text;

  doc.font(FONTS.body).fontSize(FONT_SIZE).fillColor(color);
  doc.text(row.date, columns.date, top, { width: COLUMNS.date });
  doc.text(clean(row.origin), columns.origin, top, { width: COLUMNS.origin });
  doc.font(FONTS.bodyBold).text(row.amount, columns.amount, top, {
    width: COLUMNS.amount,
    align: 'right',
  });
  doc
    .font(row.isReversal ? FONTS.displayItalic : FONTS.body)
    .fontSize(row.isReversal ? FONT_SIZE + 0.5 : FONT_SIZE)
    .text(rowDetail(row), columns.detail, top, {
      width: columns.detailWidth,
    });

  doc.y = Math.max(doc.y, top + FONT_SIZE + 2) + ROW_GAP;
}

function drawTotals(doc: Doc, statement: AccountStatement): void {
  const width = 240;
  const left = doc.page.margins.left + contentWidth(doc) - width;
  doc.y += 10;
  ensureSpace(doc, statement.totals.length * 18 + 20);

  const ruleY = doc.y;
  doc
    .save()
    .moveTo(left, ruleY)
    .lineTo(left + width, ruleY)
    .lineWidth(0.5)
    .strokeOpacity(0.45)
    .stroke(COLORS.accent)
    .restore();
  doc.y = ruleY + 8;

  statement.totals.forEach((total) => {
    const top = doc.y;
    const size = total.highlight ? 12 : FONT_SIZE + 1;
    doc
      .font(total.highlight ? FONTS.displayBold : FONTS.body)
      .fontSize(size)
      .fillColor(total.highlight ? COLORS.text : COLORS.muted)
      .text(total.label, left, top, { width: width - 100 });
    doc
      .font(FONTS.bodyBold)
      .fontSize(size)
      .fillColor(total.highlight ? COLORS.accent : COLORS.text)
      .text(total.value, left, top, { width, align: 'right' });
    doc.y = Math.max(doc.y, top + size) + 5;
  });
}
