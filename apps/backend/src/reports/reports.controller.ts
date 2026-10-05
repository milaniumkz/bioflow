import { BadRequestException, Controller, Get, Query, Res } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Response } from "express";
import JSZip from "jszip";
import PDFDocument from "pdfkit";
import { CurrentUser as CurrentUserDecorator, CurrentUser } from "../common/current-user.decorator";
import { createdAtRange, DateRangeQuery } from "../common/date-range";
import { Permissions } from "../common/permissions.decorator";
import { PrismaService } from "../prisma/prisma.service";

@ApiTags("reports")
@ApiBearerAuth()
@Controller("reports")
export class ReportsController {
  constructor(private readonly prisma: PrismaService) {}

  @Permissions("reports.read")
  @Get()
  async report(@Query("type") type: string, @Query() query: DateRangeQuery, @CurrentUserDecorator() user: CurrentUser) {
    return this.buildReport(type, user, query);
  }

  @Permissions("reports.read")
  @Get("export")
  async export(@Query("type") type: string, @Query("format") format: string, @Query() query: DateRangeQuery, @CurrentUserDecorator() user: CurrentUser, @Res() res: Response) {
    const report = await this.buildReport(type, user, query);
    const normalizedFormat = format || "csv";
    const baseName = `bioflow-${report.type}`;
    if (normalizedFormat === "xlsx") {
      const buffer = await toXlsx(report.rows);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${baseName}.xlsx"`);
      res.send(buffer);
      return;
    }
    if (normalizedFormat === "pdf") {
      const buffer = await toPdf(report);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${baseName}.pdf"`);
      res.send(buffer);
      return;
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${baseName}.csv"`);
    res.send(toCsv(report.rows));
  }

  private async buildReport(type: string, user: CurrentUser, query: DateRangeQuery = {}) {
    const generatedAt = new Date().toISOString();
    const reportType = type || "movements";
    if (!reportTypes.has(reportType)) throw new BadRequestException("Unknown report type");
    const range = createdAtRange(query);
    if (reportType === "inventory") {
      const rows = await this.prisma.inventoryItem.findMany({ where: { warehouse: { organizationId: user.organizationId } }, include: { warehouse: true, materialType: true, productType: true } });
      return { type: reportType, generatedAt, userId: user.id, filters: { type: reportType, ...query }, rows };
    }
    if (reportType === "waybills" || reportType === "deliveries") {
      const rows = await this.prisma.waybill.findMany({
        where: { organizationId: user.organizationId, ...range },
        orderBy: { createdAt: "desc" },
        take: 500,
        include: { counterparty: true, vehicle: true, driver: true, extractionSite: true, destinationWarehouse: true, materialType: true }
      });
      return { type: reportType, generatedAt, userId: user.id, filters: { type: reportType, ...query }, rows };
    }
    if (reportType === "discrepancies") {
      const rows = await this.prisma.acceptance.findMany({
        where: { reason: { not: null }, waybill: { organizationId: user.organizationId }, ...range },
        orderBy: { createdAt: "desc" },
        take: 500,
        include: { waybill: { include: { counterparty: true, destinationWarehouse: true } } }
      });
      return { type: reportType, generatedAt, userId: user.id, filters: { type: reportType, ...query }, rows };
    }
    if (reportType === "washing") {
      const rows = await this.prisma.washingBatch.findMany({ where: { organizationId: user.organizationId, ...range }, orderBy: { createdAt: "desc" }, take: 500, include: { warehouse: true } });
      return { type: reportType, generatedAt, userId: user.id, filters: { type: reportType, ...query }, rows };
    }
    if (reportType === "production") {
      const rows = await this.prisma.productionBatch.findMany({ where: { organizationId: user.organizationId, ...range }, orderBy: { createdAt: "desc" }, take: 500, include: { warehouse: true, productType: true } });
      return { type: reportType, generatedAt, userId: user.id, filters: { type: reportType, ...query }, rows };
    }
    if (reportType === "write-offs") {
      const rows = await this.prisma.writeOff.findMany({ where: { organizationId: user.organizationId, ...range }, orderBy: { createdAt: "desc" }, take: 500, include: { warehouse: true, materialType: true, productType: true } });
      return { type: reportType, generatedAt, userId: user.id, filters: { type: reportType, ...query }, rows };
    }
    if (reportType === "shipments") {
      const rows = await this.prisma.shipment.findMany({ where: { organizationId: user.organizationId, ...range }, orderBy: { createdAt: "desc" }, take: 500, include: { warehouse: true, productType: true } });
      return { type: reportType, generatedAt, userId: user.id, filters: { type: reportType, ...query }, rows };
    }
    if (reportType === "transfers") {
      const rows = await this.prisma.warehouseTransfer.findMany({
        where: { organizationId: user.organizationId, ...range },
        orderBy: { createdAt: "desc" },
        take: 500,
        include: { fromWarehouse: true, toWarehouse: true, items: { include: { materialType: true, productType: true } } }
      });
      return { type: reportType, generatedAt, userId: user.id, filters: { type: reportType, ...query }, rows };
    }
    if (reportType === "audit") {
      const rows = await this.prisma.auditLog.findMany({ where: { organizationId: user.organizationId, ...range }, orderBy: { createdAt: "desc" }, take: 500 });
      return { type: reportType, generatedAt, userId: user.id, filters: { type: reportType, ...query }, rows };
    }
    const rows = await this.prisma.inventoryMovement.findMany({ where: { organizationId: user.organizationId, ...range }, orderBy: { createdAt: "desc" }, take: 500, include: { warehouse: true, materialType: true, productType: true, waybill: true } });
    return { type: reportType, generatedAt, userId: user.id, filters: { type: reportType, ...query }, rows };
  }
}

const reportTypes = new Set(["inventory", "waybills", "deliveries", "discrepancies", "washing", "production", "write-offs", "shipments", "transfers", "audit", "movements"]);

function toCsv(rows: unknown[]) {
  if (rows.length === 0) return "";
  const flatRows = rows.map((row) => flatten(row as Record<string, unknown>));
  const headers = [...new Set(flatRows.flatMap((row) => Object.keys(row)))];
  const lines = [
    headers.join(","),
    ...flatRows.map((row) => headers.map((header) => csvCell(row[header])).join(","))
  ];
  return lines.join("\n");
}

function flatten(row: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  return Object.entries(row).reduce<Record<string, unknown>>((acc, [key, value]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(value)) {
      acc[`${nextKey}.summary`] = value.map(summarizeArrayItem).join("; ");
    } else if (value && typeof value === "object" && !(value instanceof Date)) {
      Object.assign(acc, flatten(value as Record<string, unknown>, nextKey));
    } else {
      acc[nextKey] = value;
    }
    return acc;
  }, {});
}

function summarizeArrayItem(value: unknown) {
  if (!value || typeof value !== "object") return String(value ?? "");
  const item = value as Record<string, any>;
  const name = item.materialType?.name ?? item.productType?.name ?? item.name ?? item.id ?? "item";
  return item.quantity == null ? String(name) : `${name}:${item.quantity}`;
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll("\"", "\"\"")}"`;
}

async function toXlsx(rows: unknown[]) {
  const flatRows = rows.map((row) => flatten(row as Record<string, unknown>));
  const headers = [...new Set(flatRows.flatMap((row) => Object.keys(row)))];
  const zip = new JSZip();
  zip.file("[Content_Types].xml", xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`));
  zip.folder("_rels")?.file(".rels", xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`));
  zip.folder("xl")?.file("workbook.xml", xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets>
</workbook>`));
  zip.folder("xl")?.folder("_rels")?.file("workbook.xml.rels", xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`));
  const sheetRows = [headers, ...flatRows.map((row) => headers.map((header) => row[header]))];
  zip.folder("xl")?.folder("worksheets")?.file("sheet1.xml", xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
${sheetRows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, colIndex) => `<c r="${columnName(colIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${escapeXml(value == null ? "" : String(value))}</t></is></c>`).join("")}</row>`).join("")}
</sheetData></worksheet>`));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function xml(value: string) {
  return value.trim();
}

function columnName(index: number) {
  let name = "";
  let next = index + 1;
  while (next > 0) {
    const remainder = (next - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    next = Math.floor((next - 1) / 26);
  }
  return name;
}

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;");
}

async function toPdf(report: { type: string; generatedAt: string; userId: string; filters: unknown; rows: unknown[] }) {
  return new Promise<Buffer>((resolve) => {
    const doc = new PDFDocument({ margin: 36, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.fontSize(18).text("BIOFLOW report");
    doc.moveDown(0.5).fontSize(10).text(`Type: ${report.type}`);
    doc.text(`Generated: ${report.generatedAt}`);
    doc.text(`User: ${report.userId}`);
    doc.text(`Filters: ${JSON.stringify(report.filters)}`);
    doc.moveDown();
    const flatRows = report.rows.slice(0, 80).map((row) => flatten(row as Record<string, unknown>));
    flatRows.forEach((row, index) => {
      doc.fontSize(9).text(`${index + 1}. ${JSON.stringify(row)}`, { width: 520 });
      doc.moveDown(0.25);
    });
    doc.end();
  });
}
