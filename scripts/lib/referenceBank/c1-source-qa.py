"""C1 source catalogue, Schweser OCR corpus isolation, and extraction QA."""
import hashlib
import json
import pathlib
import re

ROOT = pathlib.Path('/Users/advay/Documents/Structured Learning App')
REF = ROOT / 'content/source-packs/private/reference-2027'
OUT = ROOT / 'output/question-bank/2027'

OFFICIAL = [
    ('quant', '/Users/advay/Downloads/1. Curriculum 2027 Books/2027_CFA_L1V1_Quants_ONLINE.pdf'),
    ('econ', '/Users/advay/Downloads/1. Curriculum 2027 Books/2027_CFA_L1V2_Econ_ONLINE.pdf'),
    ('ci', '/Users/advay/Downloads/1. Curriculum 2027 Books/2027_CFA_L1V3_CorpFin_ONLINE.pdf'),
    ('fsa', '/Users/advay/Downloads/1. Curriculum 2027 Books/2027_CFA_L1V4_FSA_ONLINE.pdf'),
    ('eq', '/Users/advay/Downloads/1. Curriculum 2027 Books/2027_CFA_L1V5_Equities_ONLINE.pdf'),
    ('fi', '/Users/advay/Downloads/1. Curriculum 2027 Books/2027_CFA_L1V6_FI_ONLINE.pdf'),
    ('deriv', '/Users/advay/Downloads/1. Curriculum 2027 Books/2027_CFA_L1V7_Derivs_ONLINE.pdf'),
    ('alt', '/Users/advay/Downloads/1. Curriculum 2027 Books/2027_CFA_L1V8_Alts_ONLINE.pdf'),
    ('pm', '/Users/advay/Downloads/1. Curriculum 2027 Books/2027_CFA_L1V9_PortConstr_ONLINE.pdf'),
    ('eth', '/Users/advay/Downloads/1. Curriculum 2027 Books/2027_CFA_L1V10_Ethics_ONLINE.pdf'),
]
PREREQS = [
    ('prereq-econ', '/Users/advay/Downloads/1. Curriculum 2027 Books/cfa-program2027L1PrereqRead-Economics.PDF'),
    ('prereq-fsa', '/Users/advay/Downloads/1. Curriculum 2027 Books/cfa-program2027L1PrereqRead-Financial Statement Analysis.PDF'),
]
SCHWESER = [
    ('schweser-qm-eco-cf', ['quant', 'econ', 'ci'], '/Users/advay/Downloads/Schweser CFA L1 2027 QM,ECO,CF.pdf'),
    ('schweser-fsa-eq', ['fsa', 'eq'], '/Users/advay/Downloads/Schweser CFA L1 2027 FSA , EQ.pdf'),
    ('schweser-fi-der', ['fi', 'deriv'], '/Users/advay/Downloads/Schweser CFA L1 2027 FI, DER.pdf'),
    ('schweser-ai-pc-ethics', ['alt', 'pm', 'eth'], '/Users/advay/Downloads/Schweser CFA L1 2027 AI,PC,ETHICS.pdf'),
]

QUIZ_OR_EXAMPLE_RE = re.compile(
    r'MODULE\s+[QO]U[I1]?Z|CONCEPT CHECKER|ANSWER KEY|ANSWERS TO MODULE|QUIZ ANSWERS|^\s*EXAMPLE\b|\bSolution:\s|\bAnswer:\s|^\s*\d+\.\s+[ABC]\b',
    re.I | re.M,
)
FORMULA_SUSPECT_RE = re.compile(r'[=∑∫√±×÷]|PV\s*=|FV\s*=|NPV\s*=|IRR\s*=')


def sha256_file(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def main():
    sources = []
    qa_items = []
    exclusions = {}

    # 1. Official 10 volumes
    for topic, fp in OFFICIAL:
        ref_doc = json.loads((REF / f'{topic}.reference').read_text())
        all_pages = [p for c in ref_doc['chapters'] for p in c['pages']]
        empty_pages = [p['pdfPage'] for p in all_pages if not p['text'].strip()]
        sources.append({
            'id': f'official-{topic}',
            'file': fp,
            'sha256': ref_doc['sha256'],
            'pages': ref_doc['pages'],
            'edition': '2027',
            'role': 'official_main',
            'rightsState': 'unconfirmed',
            'permittedUse': 'internal_authoring',
            'extractionStatus': 'machine_extracted_text',
            'humanCheckStatus': 'pending_human_review',
            'extractedFactualPages': len(all_pages),
            'readings': len(ref_doc['chapters']),
        })
        qa_items.append({
            'id': f'official-{topic}',
            'pages': ref_doc['pages'],
            'factualPagesRetained': len(all_pages),
            'emptyFactualPages': empty_pages,
            'lowTitleMatches': [c['readingId'] for c in ref_doc['chapters'] if c['titleSimilarity'] < 0.7],
            'status': 'pass_machine_check',
        })

    # 2. 2 Prerequisites
    for key, fp in PREREQS:
        doc = json.loads((REF / f'{key}.reference').read_text())
        empty_pages = [p['pdfPage'] for p in doc['content'] if not p['text'].strip()]
        sources.append({
            'id': key,
            'file': fp,
            'sha256': doc['sha256'],
            'pages': doc['pages'],
            'edition': '2027',
            'role': 'prerequisite_background',
            'rightsState': 'unconfirmed',
            'permittedUse': 'internal_authoring',
            'extractionStatus': 'machine_extracted_text',
            'humanCheckStatus': 'pending_human_review',
            'extractedFactualPages': doc['nonEmptyPages'],
        })
        qa_items.append({
            'id': key,
            'pages': doc['pages'],
            'nonEmptyPages': doc['nonEmptyPages'],
            'emptyPages': empty_pages,
            'status': 'pass_machine_check',
        })

    # 3. 4 Schweser OCR scans
    for key, topics, fp in SCHWESER:
        p = pathlib.Path(fp)
        sha = sha256_file(p)
        visual_file = REF / 'closeout/visual-qa.reference'
        visual = json.loads(visual_file.read_text())['pages'] if visual_file.exists() else []
        visual_excluded = {v['pdfPage'] for v in visual if v['source'] == key and v['sourceSha256'] == sha and v['disposition'] == 'exclude_raw_page_from_grounding'}
        ocr_path = REF / f'{key}.ocr.jsonl'
        rows = [json.loads(line) for line in ocr_path.read_text().splitlines() if line.strip()]
        factual_pages = []
        excluded_pages = []
        low_conf_pages = []
        empty_pages = []
        formula_suspect_pages = []

        for r in rows:
            txt = r['text']
            pg = r['pdfPage']
            if not txt.strip():
                empty_pages.append(pg)
                continue
            if r['meanConfidence'] < 0.85 or r['minConfidence'] < 0.45:
                low_conf_pages.append({'pdfPage': pg, 'meanConf': r['meanConfidence'], 'minConf': r['minConfidence']})
            if pg in visual_excluded or QUIZ_OR_EXAMPLE_RE.search(txt) or len(re.findall(r'^\s*[ABC][.)]\s+', txt, re.M)) >= 2:
                excluded_pages.append({'pdfPage': pg, 'reason': 'quiz_or_example_detected'})
                continue
            if FORMULA_SUSPECT_RE.search(txt) and r['meanConfidence'] < 0.95:
                formula_suspect_pages.append({'pdfPage': pg, 'meanConf': r['meanConfidence']})
            factual_pages.append({
                'pdfPage': pg,
                'lineCount': r['lineCount'],
                'meanConfidence': r['meanConfidence'],
                'minConfidence': r['minConfidence'],
                'ocrStatus': 'provisional_ocr_machine_checked',
                'humanVerified': False,
                'text': txt,
            })

        mean_all = round(sum(r['meanConfidence'] for r in rows if r['lineCount'] > 0) / max(1, sum(1 for r in rows if r['lineCount'] > 0)), 4)
        (REF / f'{key}.reference').write_text(json.dumps({
            'intakeVersion': 1,
            'id': key,
            'topics': topics,
            'file': fp,
            'sha256': sha,
            'pages': len(rows),
            'role': 'provider_supplement_ocr_provisional',
            'rightsState': 'unconfirmed',
            'permittedUse': 'internal_authoring',
            'ocrEngine': 'macOS Vision VNRecognizeTextRequest (accurate, local)',
            'ocrStatus': 'provisional_ocr_machine_checked',
            'humanCheckStatus': 'pending_human_review',
            'factualPagesRetained': len(factual_pages),
            'excludedQuizOrExamplePages': len(excluded_pages),
            'pagesContent': factual_pages,
        }, ensure_ascii=False))

        exclusions[key] = excluded_pages
        sources.append({
            'id': key,
            'topics': topics,
            'file': fp,
            'sha256': sha,
            'pages': len(rows),
            'edition': '2027',
            'role': 'provider_supplement_ocr_provisional',
            'rightsState': 'unconfirmed',
            'permittedUse': 'internal_authoring',
            'extractionStatus': 'provisional_ocr_local_vision',
            'humanCheckStatus': 'pending_human_review',
            'ocrMeanConfidence': mean_all,
            'factualPagesRetained': len(factual_pages),
            'excludedQuizOrExamplePages': len(excluded_pages),
        })
        qa_items.append({
            'id': key,
            'pages': len(rows),
            'ocrMeanConfidence': mean_all,
            'factualPagesRetained': len(factual_pages),
            'excludedQuizOrExamplePages': len(excluded_pages),
            'emptyPages': empty_pages,
            'lowConfidencePageCount': len(low_conf_pages),
            'lowConfidenceSample': low_conf_pages[:10],
            'formulaSuspectPageCount': len(formula_suspect_pages),
            'formulaSuspectSample': formula_suspect_pages[:10],
            'status': 'provisional_ocr_requires_page_qa_for_formulas',
        })

    (REF / 'schweser-exclusions.json').write_text(json.dumps(exclusions, indent=2) + '\n')
    (REF / 'source-catalogue-c1.json').write_text(json.dumps({'edition': '2027', 'sources': sources}, indent=2) + '\n')
    (OUT / 'source-intake.json').write_text(json.dumps({
        'edition': '2027',
        'totalFiles': len(sources),
        'officialVolumes': 10,
        'prerequisiteBooks': 2,
        'schweserSupplements': 4,
        'sources': sources,
        'privateTextExported': False,
        'sourceInstructionsFollowed': False,
        'semanticReferenceSupport': 'Provisional OCR & machine extraction complete; human verification required before release',
    }, indent=2) + '\n')
    (OUT / 'c1-extraction-qa.json').write_text(json.dumps({
        'phase': 'C1',
        'totalSources': len(sources),
        'qaItems': qa_items,
        'note': 'OCR confidence values are directly emitted by macOS Vision VNRecognizeTextRequest. Formula regions with meanConfidence < 0.95 require visual comparison against original PDFs before relying on them for released items.',
    }, indent=2) + '\n')
    print(json.dumps({'sources': len(sources), 'qaSummary': [{k: q[k] for k in ('id', 'pages', 'status') if k in q} for q in qa_items]}, indent=2))


if __name__ == '__main__':
    main()
