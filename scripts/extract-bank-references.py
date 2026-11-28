"""Private reference intake. Provider exercises are excluded from authoring text, retained only as overlap hashes."""
import argparse
import concurrent.futures
import hashlib
import json
import pathlib
import re
from difflib import SequenceMatcher

TOPICS = ['quant', 'econ', 'ci', 'fsa', 'eq', 'fi', 'deriv', 'alt', 'pm', 'eth']


def norm(text):
    return re.sub(r'[^a-z0-9]+', ' ', text.lower()).strip()


def bookmarks(reader, entries, depth=0):
    out = []
    for entry in entries:
        if isinstance(entry, list):
            out.extend(bookmarks(reader, entry, depth + 1))
        elif isinstance(entry, dict):
            page = reader.get_destination_page_number(entry)
            if page is not None:
                out.append({'title': str(entry.get('/Title', '')), 'page': page, 'depth': depth})
    return out


def excluded_intervals(outline, end):
    intervals = []
    for i, entry in enumerate(outline):
        if re.search(r'practice problems|solutions|pre[- ]?test|^example\b|application of the standard', entry['title'], re.I):
            stop = next((x['page'] for x in outline[i + 1:] if x['depth'] <= entry['depth']), end)
            intervals.append((entry['page'], stop))
    return intervals


def digest_file(file):
    digest = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def extract(task):
    from pypdf import PdfReader
    topic, file, readings, destination = task
    file, destination = pathlib.Path(file), pathlib.Path(destination)
    existing = destination / f'{topic}.reference'
    if existing.exists():
        doc = json.loads(existing.read_text())
        if doc.get('intakeVersion') == 2 and doc['sha256'] == digest_file(file):
            return {k: v for k, v in doc.items() if k != 'chapters'} | {'readings': len(doc['chapters']), 'lowTitleMatches': [x['readingId'] for x in doc['chapters'] if x['titleSimilarity'] < .7]}
    reader = PdfReader(file)
    outline = bookmarks(reader, reader.outline)
    all_modules = [x for x in outline if re.match(r'^Learning Module\s+\d+\b', x['title'], re.I)]
    modules = [x for x in all_modules if not re.search(r'Appendic', x['title'], re.I)]
    assert len(modules) == len(readings), (topic, 'module count mismatch', len(modules), len(readings))
    text = [page.extract_text() or '' for page in reader.pages]
    excluded = excluded_intervals(outline, len(text))
    chapters = []
    for i, (module, reading) in enumerate(zip(modules, readings)):
        title = re.sub(r'^Learning Module\s+\d+\s*', '', module['title'], flags=re.I)
        similarity = SequenceMatcher(None, norm(title), norm(reading['title'])).ratio()
        stop = next((x['page'] for x in all_modules if x['page'] > module['page']), len(text))
        pages = []
        for p in range(module['page'], stop):
            if any(start <= p < finish for start, finish in excluded):
                continue
            if re.search(r'PRE[-\s]?TEST|(?:^|\n)\s*Solution\s*:|(?:^|\n)\s*[ABC]\.\s|\bEXAMPLE\s+\d+', text[p], re.I):
                continue
            clean = re.sub(r'© CFA Institute[^\n]*', '', text[p])
            pages.append({'pdfPage': p + 1, 'printedPage': reader.page_labels[p], 'text': clean})
        assert pages and any(x['text'].strip() for x in pages), (topic, reading['id'], 'no factual text')
        chapters.append({'readingId': reading['id'], 'catalogueTitle': reading['title'], 'sourceTitle': title,
                         'titleSimilarity': round(similarity, 3), 'mappingStatus': 'pending_human_review',
                         'firstPdfPage': module['page'] + 1, 'lastPdfPage': stop, 'pages': pages})
    doc = {'intakeVersion': 2, 'topicId': topic, 'file': str(file), 'sha256': digest_file(file), 'pages': len(text),
           'sourceRole': 'user-provided reference; not a licence or human sign-off',
           'exerciseExclusion': 'Bookmark ranges for practice, solutions, examples and standards applications excluded from authoring text.',
           'chapters': chapters}
    (destination / f'{topic}.reference').write_text(json.dumps(doc, ensure_ascii=False))
    # No provider question is supplied to the writer. Whole-book word runs are used only to reject possible copying.
    words = norm(' '.join(text)).split()
    grams = {hashlib.sha256(' '.join(words[i:i + 8]).encode()).hexdigest()[:16] for i in range(max(0, len(words) - 7))}
    (destination / f'{topic}.grams').write_text('\n'.join(sorted(grams)))
    return {k: v for k, v in doc.items() if k != 'chapters'} | {'readings': len(chapters), 'lowTitleMatches': [x['readingId'] for x in chapters if x['titleSimilarity'] < .7]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory')
    parser.add_argument('--catalogue')
    parser.add_argument('--out')
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        assert norm('Bond—Valuation!') == 'bond valuation'
        spans = excluded_intervals([{'title': 'Practice Problems', 'page': 5, 'depth': 2}, {'title': 'nested', 'page': 6, 'depth': 3}, {'title': 'Next Module', 'page': 8, 'depth': 1}], 10)
        assert spans == [(5, 8)]
        print('PASS reference intake normalization and exercise-boundary checks')
        return
    assert args.directory and args.catalogue and args.out, 'Pass directory, catalogue and out explicitly.'
    catalogue = json.loads(pathlib.Path(args.catalogue).read_text())
    out = pathlib.Path(args.out); out.mkdir(parents=True, exist_ok=True)
    tasks = []
    for volume, topic in enumerate(TOPICS, 1):
        files = list(pathlib.Path(args.directory).glob(f'2027_CFA_L1V{volume}_*.pdf'))
        assert len(files) == 1, (topic, files)
        readings = sorted([r for r in catalogue['readings'] if r['topic_id'] == topic], key=lambda r: r['reading_no'])
        tasks.append((topic, str(files[0]), readings, str(out)))
    results = []
    with concurrent.futures.ProcessPoolExecutor(max_workers=3) as executor:
        for result in executor.map(extract, tasks):
            results.append(result); print(json.dumps(result), flush=True)
    (out / 'manifest.reference').write_text(json.dumps({'edition': '2027', 'documents': results}, indent=2))


if __name__ == '__main__':
    main()
