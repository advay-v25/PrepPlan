from pathlib import Path
from PIL import Image, ImageOps, ImageDraw
from pypdf import PdfReader

root = Path('tmp/pdfs/roadmap-team')
pdf = PdfReader('output/pdf/Roadmap-Product-and-Workflow-Guide.pdf')
assert len(pdf.pages) == 13
for i, page in enumerate(pdf.pages, 1):
    text = page.extract_text()
    assert 'ROADMAP' in text and f'{i:02d}' in text
    assert len(text) > 450, (i, len(text))
    assert '\ufffd' not in text
files = sorted(root.glob('page-*.png'))
assert len(files) == 13
for group in range(0, len(files), 4):
    images = [Image.open(p).convert('RGB') for p in files[group:group+4]]
    w, h = images[0].size
    sheet = Image.new('RGB', (w*2+30, h*2+50), '#d8dde4')
    d = ImageDraw.Draw(sheet)
    for j, im in enumerate(images):
        x, y = 10+(j%2)*(w+10), 20+(j//2)*(h+20)
        sheet.paste(im, (x,y))
        d.text((x,y-14), f'Page {group+j+1}', fill='black')
    sheet.save(root / f'review-{group//4+1}.png')
print('PASS: 13 pages, page numbering, expected text and no replacement characters. Four review sheets ready.')
