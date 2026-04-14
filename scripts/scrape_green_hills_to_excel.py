#!/usr/bin/env python3

import html
import re
import subprocess
import zipfile
from collections import OrderedDict
from html.parser import HTMLParser
from pathlib import Path
from xml.sax.saxutils import escape


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "green_hills_supply_products.xlsx"
PAGES = [
    "https://greenhillssupply.com/shop/",
    "https://greenhillssupply.com/shop/page/2/",
    "https://greenhillssupply.com/shop/page/3/",
    "https://greenhillssupply.com/shop/page/4/",
    "https://greenhillssupply.com/shop/page/5/",
]


def fetch(url: str) -> str:
    result = subprocess.run(
        [
            "curl",
            "-L",
            "-A",
            "Mozilla/5.0",
            "-H",
            "Accept-Language: en-US,en;q=0.9",
            url,
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout


def strip_tags(value: str) -> str:
    text = re.sub(r"<br\s*/?>", " ", value, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def clean_price(value: str) -> str:
    text = html.unescape(value)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\$\s+(\d)", r"$\1", text)
    text = re.sub(r"\s*-\s*", " - ", text)
    text = re.sub(r"\s*–\s*", " – ", text)
    for marker in [
        " Price range:",
        " Add to cart",
        " Select options",
        " This product has multiple variants.",
        " Units ",
    ]:
        if marker in text:
            text = text.split(marker, 1)[0].strip()
    return text


class ProductParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.items: list[tuple[str, str]] = []
        self.in_product = False
        self.product_li_depth = 0
        self.title_depth = 0
        self.price_depth = 0
        self.current_name: list[str] = []
        self.current_price: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        attr_map = dict(attrs)
        classes = attr_map.get("class", "") or ""

        if tag == "li" and "product" in classes.split():
            self.in_product = True
            self.product_li_depth = 1
            self.current_name = []
            self.current_price = []
            return

        if not self.in_product:
            return

        if tag == "li":
            self.product_li_depth += 1
        elif tag == "h2" and "woocommerce-loop-product__title" in classes.split():
            self.title_depth = 1
        elif self.title_depth:
            self.title_depth += 1
        elif tag == "span" and "price" in classes.split():
            self.price_depth = 1
        elif self.price_depth:
            self.price_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if not self.in_product:
            return

        if self.title_depth:
            self.title_depth -= 1

        if self.price_depth:
            self.price_depth -= 1

        if tag == "li":
            self.product_li_depth -= 1
            if self.product_li_depth == 0:
                name = " ".join(part.strip() for part in self.current_name if part.strip()).strip()
                price = " ".join(part.strip() for part in self.current_price if part.strip()).strip()
                name = re.sub(r"\s+", " ", html.unescape(name))
                price = clean_price(price)
                if name and price:
                    self.items.append((name, price))
                self.in_product = False

    def handle_data(self, data: str) -> None:
        if self.title_depth:
            self.current_name.append(data)
        if self.price_depth:
            self.current_price.append(data)


def parse_products(page_html: str) -> list[tuple[str, str]]:
    parser = ProductParser()
    parser.feed(page_html)
    return parser.items


def col_name(index: int) -> str:
    name = ""
    while index:
        index, rem = divmod(index - 1, 26)
        name = chr(65 + rem) + name
    return name


def write_xlsx(rows: list[tuple[str, str]], output_path: Path) -> None:
    data = [("Product Name", "Price")] + rows

    shared_strings: OrderedDict[str, int] = OrderedDict()
    for row in data:
        for value in row:
            shared_strings.setdefault(value, len(shared_strings))

    def cell_xml(row_idx: int, col_idx: int, value: str) -> str:
        ref = f"{col_name(col_idx)}{row_idx}"
        return f'<c r="{ref}" t="s"><v>{shared_strings[value]}</v></c>'

    sheet_rows = []
    for row_idx, row in enumerate(data, start=1):
        cells = "".join(cell_xml(row_idx, col_idx, value) for col_idx, value in enumerate(row, start=1))
        sheet_rows.append(f'<row r="{row_idx}">{cells}</row>')

    shared_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        f'count="{len(data) * 2}" uniqueCount="{len(shared_strings)}">'
        + "".join(f"<si><t>{escape(value)}</t></si>" for value in shared_strings)
        + "</sst>"
    )

    sheet_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheetData>'
        + "".join(sheet_rows)
        + "</sheetData>"
        "</worksheet>"
    )

    workbook_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="Products" sheetId="1" r:id="rId1"/></sheets>'
        "</workbook>"
    )

    workbook_rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
        'Target="worksheets/sheet1.xml"/>'
        '<Relationship Id="rId2" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
        'Target="styles.xml"/>'
        '<Relationship Id="rId3" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" '
        'Target="sharedStrings.xml"/>'
        "</Relationships>"
    )

    root_rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="xl/workbook.xml"/>'
        "</Relationships>"
    )

    content_types_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/sharedStrings.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
        '<Override PartName="/xl/styles.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        "</Types>"
    )

    styles_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
        '<fills count="2"><fill><patternFill patternType="none"/></fill>'
        '<fill><patternFill patternType="gray125"/></fill></fills>'
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        "</styleSheet>"
    )

    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types_xml)
        zf.writestr("_rels/.rels", root_rels_xml)
        zf.writestr("xl/workbook.xml", workbook_xml)
        zf.writestr("xl/_rels/workbook.xml.rels", workbook_rels_xml)
        zf.writestr("xl/worksheets/sheet1.xml", sheet_xml)
        zf.writestr("xl/sharedStrings.xml", shared_xml)
        zf.writestr("xl/styles.xml", styles_xml)


def main() -> None:
    seen: OrderedDict[str, str] = OrderedDict()
    for url in PAGES:
        page_html = fetch(url)
        for name, price in parse_products(page_html):
            seen.setdefault(name, price)

    rows = list(seen.items())
    write_xlsx(rows, OUTPUT_PATH)
    print(f"Wrote {len(rows)} products to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
