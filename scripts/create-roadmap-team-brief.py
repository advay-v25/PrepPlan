from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, Color, white
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph
from reportlab.lib.enums import TA_LEFT, TA_CENTER
import math

OUT = Path('output/pdf')
OUT.mkdir(parents=True, exist_ok=True)
W, H = 720, 900
C = canvas.Canvas(str(OUT / 'Roadmap-Product-and-Workflow-Guide.pdf'), pagesize=(W, H))
C.setTitle('Roadmap | Product and Workflow Guide')
C.setAuthor('Roadmap product team')
INK = HexColor('#172E49'); BLUE = HexColor('#315DEC'); MUTED = HexColor('#586B80')
LINE = HexColor('#DCE4EE'); PALE = HexColor('#F2F5FA'); GREEN = HexColor('#176453')
page_no = 0

def rect(x, y, w, h, fill=PALE, stroke=None, radius=9):
    C.setFillColor(fill)
    C.setStrokeColor(stroke or fill)
    C.roundRect(x, H-y-h, w, h, radius, fill=1, stroke=bool(stroke))

def para(text, x, y, w, size=12, color=INK, bold=False, align=TA_LEFT, limit=None):
    style = ParagraphStyle('p', fontName='Helvetica-Bold' if bold else 'Helvetica', fontSize=size,
                           leading=size*1.42, textColor=color, alignment=align, spaceAfter=0)
    p = Paragraph(text.replace('\n', '<br/>'), style)
    _, h = p.wrap(w, H)
    if limit is not None and h > limit:
        raise ValueError(f'Text overflow {h:.0f}>{limit}: {text[:75]}')
    if y+h > (H-10 if y >= 855 else 844):
        raise ValueError(f'Page overflow: {text[:75]}')
    p.drawOn(C, x, H-y-h)
    return h

def line(x1, y1, x2, y2, color=LINE, width=1):
    C.setStrokeColor(color); C.setLineWidth(width)
    C.line(x1, H-y1, x2, H-y2)

def arrow(x1,y1,x2,y2,color=BLUE):
    line(x1,y1,x2,y2,color,1.5)
    ang=math.atan2(y2-y1,x2-x1)
    for a in (ang+2.65,ang-2.65):
        line(x2,y2,x2+7*math.cos(a),y2+7*math.sin(a),color,1.5)

def page(kicker, title, subtitle):
    global page_no
    if page_no: C.showPage()
    page_no += 1
    para('ROADMAP',44,27,250,13,BLUE,True)
    para('PRODUCT & WORKFLOW GUIDE',395,29,281,9,MUTED,align=2)
    line(44,57,676,57)
    para(kicker.upper(),44,79,632,10,BLUE,True)
    para(title,44,104,632,29,INK,True,limit=87)
    para(subtitle,44,193,632,12,MUTED,limit=54)
    line(44,855,676,855)
    para('Proposed product experience | Team discussion edition',44,867,555,8,MUTED)
    para(f'{page_no:02d}',630,864,46,11,BLUE,True,align=2)

def card(x,y,w,h,title,body,num=None):
    rect(x,y,w,h)
    offset=0
    if num:
        para(num,x+16,y+13,w-32,10,BLUE,True);offset=23
    para(title,x+16,y+15+offset,w-32,14,INK,True,limit=48)
    para(body,x+16,y+70 if num else y+62,w-32,11,MUTED,limit=h-(86 if num else 77))

def band(y,title,body,color=PALE):
    rect(44,y,632,96,color)
    para(title,62,y+14,596,13,INK,True)
    para(body,62,y+39,596,11,MUTED,limit=48)

def row(y,label,body):
    para(label,44,y,155,12,INK,True)
    h=para(body,219,y,457,11,MUTED)
    line(44,y+max(h,33)+13,676,y+max(h,33)+13)

def node(x,y,w,h,title,body=None):
    rect(x,y,w,h,PALE,LINE)
    para(title,x+10,y+13,w-20,12,INK,True,TA_CENTER,limit=42)
    if body: para(body,x+12,y+51,w-24,10,MUTED,align=TA_CENTER,limit=h-59)

page('01 / The idea','A clearer next step.\nA more realistic study week.',
     'Roadmap is a competitive-exam study planner, starting with CFA Level I candidates preparing for 2027 onward.')
para('Students often have the material.<br/>What they lack is structure.',44,270,610,25,INK,True)
para('Roadmap helps them decide what to study next, how to approach it, where it fits around life, and what evidence shows they should revisit it.',44,363,620,16,MUTED)
card(44,462,198,164,'Study with a method','Clear tasks, source direction and a useful way to check understanding.','01')
card(261,462,198,164,'Fit study around life','A week the student can adjust, with personal commitments protected.','02')
card(478,462,198,164,'Build confidence','Specific learning evidence and manageable ways to restart.','03')
band(684,'The promise','Less uncertainty about what to do next - not a guarantee of passing, a prescribed hours target or a replacement for a course.')

page('02 / Who it serves','One product. Different starting points.',
     'The experience adapts to how the person is preparing, not to a judgment about whether they deserve to attempt the exam.')
row(268,'Coaching student','Needs to turn actual class coverage into consolidation, practice and revision. Classes can change; the plan should respond.')
row(355,'Self-study student','Needs a sensible starting sequence, source direction and a way to know when to revisit a concept.')
row(442,'Returning student','Needs to identify a manageable restart point without being forced to repeat everything or clear an old backlog.')
row(529,'Busy or variable week','Needs floating tasks, flexible placement and visible trade-offs around work, family and other commitments.')
card(44,650,305,156,'Roadmap is','A planner, diagnostic practice companion, progress tracker and source-directed Coach.')
card(371,650,305,156,'Roadmap is not','A textbook, full-course tutor, content marketplace or system that predicts who can pass.')
para('Commercial concept: paid planning and accountability, not resale of course material. Pricing is not defined here.',44,816,632,10,MUTED)

page('03 / The central workflow','A weekly loop, not a one-time plan.',
     'The same process produces the first week and improves each following week. The student approves meaningful changes.')
node(44,275,194,116,'1. Understand the week','Current learning, priorities and real-life constraints')
node(263,275,194,116,'2. Suggest useful work','Study approach, source reference and possible placement')
node(482,275,194,116,'3. Review and accept','Change scope, move tasks or keep them flexible')
arrow(238,330,263,330);arrow(457,330,482,330)
arrow(579,391,579,452)
node(482,452,194,116,'4. Study and record','Log planned work, classes or learning done elsewhere')
node(263,452,194,116,'5. Check understanding','Attempt relevant questions; identify specific gaps')
node(44,452,194,116,'6. Reflect and adapt','Refresh priorities and constraints for the next week')
arrow(482,510,457,510);arrow(263,510,238,510);arrow(141,452,141,391)
para('Repeat with better context - not automatically more work.',44,604,632,16,BLUE,True,TA_CENTER)
band(670,'Real life can enter at any point','A cancelled class, travel, a missed task or extra study can trigger a proposed adjustment. Completed work stays recorded; changes are not silently imposed.')

page('04 / First-time experience','From account creation to a useful week.',
     'Setup collects only what helps the next week. Students can explore first, skip unknowns and return later.')
entries=[
 ('1','Starting point','Preparation mode, current stage and tentative exam month - or undecided.'),
 ('2','Learning anchor','Recent class coverage or current study section, plus one useful weekly priority.'),
 ('3','Where they study','A book section, course lesson or link. Uploading is optional, never required.'),
 ('4','Fit around life','Protected commitments, possible study windows and a comfortable sitting preference.'),
 ('5','Practice preference','A short check after relevant study; an immediate check is optional for covered material.'),
 ('6','Review a real draft','Accept useful tasks, lighten scope, adjust times or keep tasks unscheduled.')]
for i,(n,t,b) in enumerate(entries):
    y=263+i*80
    rect(44,y,33,33,BLUE)
    para(n,44,y+7,33,12,white,True,TA_CENTER)
    para(t,94,y,582,13,INK,True)
    para(b,94,y+24,582,11,MUTED)
band(754,'No academic access gate','An ambitious exam date, missing material, an unfinished setup or a low test score never disqualifies the student from support.')

page('05 / The pages','Different pages. One shared roadmap.',
     'The pages are different views of the same learning journey. Materials are managed within the experience, not through a separate main tab.')
node(244,266,232,94,'HOME','Next useful action + quick learning capture')
for x,t,b in [(44,'MY WEEK','When and how the work fits'),(263,'CURRICULUM','Where concepts connect'),(482,'PRACTICE','What understanding is supported')]:
    node(x,419,194,106,t,b)
arrow(320,360,141,419);arrow(360,360,360,419);arrow(400,360,579,419)
rect(44,575,632,95,HexColor('#EDF2FF'))
para('COACH',64,591,592,13,BLUE,True)
para('Available as its own page and beside a task or result. Explains, proposes and acts through the same plan - not a separate schedule hidden in chat.',64,618,592,11,INK)
arrow(141,525,141,575);arrow(360,525,360,575);arrow(579,525,579,575)
row(704,'Study sources','Source controls inside setup, tasks and modules; a central source manager lives in Settings.')
row(782,'Settings','Account, editable context, privacy and optional reminders. No standalone balance or confidence tab.')

page('06 / The daily experience','A task should explain how to begin.',
     'Home prioritises a useful action, not a wall of scores. A student can also log a class or unplanned study at any time.')
rect(44,267,632,342)
para('ILLUSTRATIVE TASK - NOT A LIVE RECOMMENDATION',64,285,592,9,BLUE,True)
para('Consolidate the inventory section\ncovered in class',64,315,580,22,INK,True)
para('<b>Goal:</b> understand the specific relationship covered in the section.',64,394,578,12)
para('<b>Where:</b> the student\'s confirmed lesson or book reference, linked to the relevant learning outcome.',64,431,578,12)
para('<b>Approach:</b> revisit a bounded section, close the source, explain the relationship in your own words, then try an unfamiliar application question.',64,479,578,12)
para('<b>Next:</b> use the check to decide what needs another look.',64,552,578,12)
row(650,'Task actions','Start, mark partial progress, complete, move, split or defer. Suggested methods are not mandatory completion gates.')
row(739,'Learning outcome','A specific skill or understanding expected in the curriculum. Often called an LOS: Learning Outcome Statement.')

page('07 / Practice and confidence','Confidence should have something behind it.',
     'A diagnostic is a focused set of questions used to identify understanding and gaps - not an entrance exam or a judgment of the student.')
node(44,268,194,119,'Attempt','Relevant questions; an untimed option where appropriate')
node(263,268,194,119,'Understand the miss','Identify the concept or reasoning step, not just the score')
node(482,268,194,119,'Revisit and re-check','Return to the relevant source and try a later variation')
arrow(238,326,263,326);arrow(457,326,482,326)
para('Keep these three signals separate',44,432,632,19,INK,True)
row(479,'What was studied','Self-reported reading or class coverage shows exposure. It does not prove understanding.')
row(565,'What was shown','Answers and reasoning provide evidence about the assessed concepts. Scope, recency and uncertainty remain visible.')
row(652,'How it feels','Optional confidence feedback helps choose support. Feeling uncertain does not make a correct answer wrong.')
para('Useful feedback: “You corrected the earlier reasoning mistake and answered a new variation correctly.” Only say this when the record supports it.',44,752,632,13,BLUE,True)

page('08 / Balance and deviation','Life changes. The plan should respond.',
     'An empty calendar slot is not a study obligation. Roadmap helps the student choose trade-offs without assigning a universal weekly-hours target.')
rect(44,267,632,81,HexColor('#EDF2FF'))
para('“This week is busy. Help me maintain continuity.”',64,289,592,19,BLUE,True)
card(44,385,198,166,'Less work','Reduce the scope this week and show what will be deferred.','01')
card(261,385,198,166,'Shorter sittings','Split meaningful work into smaller sessions. Total work may stay the same.','02')
card(478,385,198,166,'Different placement','Move work or keep it flexible without pretending the scope decreased.','03')
para('The student sees a proposal before changes are applied.',44,595,632,16,INK,True,TA_CENTER)
row(646,'Protect','Confirmed work, personal time, family and other commitments. Generic labels are enough; private details are unnecessary.')
row(735,'Preserve','Completed learning and evidence. A difficult week does not reset progress, create a penalty or automatically double next week\'s tasks.')

page('09 / The source model','Useful even when a course cannot be uploaded.',
     'The product must not depend on collecting every student\'s files. It can organise learning around a source without possessing that source.')
node(44,270,194,142,'Curriculum foundation','Verified learning outcomes and supported original assessment content')
node(263,270,194,142,'Personal source map','Student-confirmed book section, class lesson or portal/Drive reference')
node(482,270,194,142,'Optional readable files','Permitted imports add detail when extraction and mapping succeed')
arrow(141,412,310,470);arrow(360,412,360,470);arrow(579,412,410,470)
node(154,470,412,89,'SOURCE-DIRECTED GUIDANCE','What to study, where to return and what to check')
row(602,'Locked portal','The student confirms the lesson and learning outcome. Roadmap links back and can offer supported curriculum-based practice; it does not pretend to read the lesson.')
row(709,'Large files / Drive','Optional permitted connections can improve source detail. Restrictions are respected; import failure never removes the student\'s useful plan.')
para('No Materials main tab. No request for portal passwords. No invented page references.',44,807,632,11,BLUE,True)

page('10 / The Coach','A guide that can take useful action.',
     'The Coach helps organise, diagnose and direct. It does not replace the course or teach an entire subject.')
row(265,'Plan with me','Draft tasks or calendar changes. Show exactly what will change, then apply the student\'s confirmation.')
row(351,'Check me','Start an eligible diagnostic on request and connect its results to a useful follow-up.')
row(437,'Help me understand\nmy progress','Explain observed coverage, strengths, specific gaps and uncertainty using the student\'s actual record.')
row(537,'Show me where\nto learn','Name the relevant learning outcome and confirmed source location. Suggest how to approach the work, not a replacement chapter.')
row(637,'Help me recover','Respond to changed circumstances or test uncertainty with practical choices, not generic praise or personal judgments.')
band(740,'The control boundary','The Coach can explain and propose. Meaningful calendar changes require confirmation. It must never claim an action succeeded when it did not.')

page('11 / An example week','Meet a student whose week does not go to plan.',
     'Illustrative coaching-student journey. Subjects, timings and actions below explain the experience; they are not a prescribed study schedule.')
events=[('After class','The student logs the section actually covered and confirms its source reference.'),
        ('Review the week','Roadmap suggests consolidation and a relevant check. The student accepts placements that fit.'),
        ('After studying','The student records partial or completed work and attempts the diagnostic when ready.'),
        ('A specific miss','Results point to the relevant learning outcome and source section. A focused review is proposed.'),
        ('Plans change','Unexpected work disrupts a sitting. The student asks the Coach for alternatives and confirms a lighter scope.'),
        ('Next checkpoint','Actual work, assessment evidence and fresh commitments shape the next draft. Nothing is blindly rolled forward.')]
for i,(t,b) in enumerate(events):
    y=270+i*88
    C.setFillColor(BLUE);C.circle(57,H-y-11,6,fill=1,stroke=0)
    if i<5:line(57,y+23,57,y+81,LINE,2)
    para(t,83,y,593,13,INK,True)
    para(b,83,y+25,593,11,MUTED)

page('12 / Scope and delivery','What we need to prove before calling it useful.',
     'This guide explains the proposed experience. It is not a claim that every workflow is implemented, deployed or validated today.')
row(266,'Foundation','Confirm the supported curriculum slice, source references and assessment quality. Unsupported areas must stay explicit.')
row(352,'First useful week','Connect setup to real tasks, draft review, acceptance, Home and the calendar/list experience.')
row(438,'Learning evidence','Connect diagnostics, results and source-directed review. Show evidence rather than fabricated readiness.')
row(524,'Second week + Coach','Prove a complete second cycle and a midweek change without losing progress or bypassing student control.')
row(610,'Optional expansion','Improve permitted imports, broaden verified curriculum support and qualify reliability before wider release.')
band(714,'The demonstration that matters','A student can start without uploading a file, accept useful work, check understanding, find what to revisit and organise another realistic week.')

page('13 / Team discussion','Decisions to align on together.',
     'Use these questions to discuss the product, not to debate implementation details.')
questions=[('1','Would this give a confused student a clearer next action?','Test the Home and task experience against that question.'),
           ('2','Can both coaching and self-study users see themselves here?','Keep the shared weekly loop, but adapt the starting information.'),
           ('3','Is our teaching boundary clear?','Guidance, specific error feedback and source direction are in; full-course tutoring is out.'),
           ('4','Does the student stay in control of their life and plan?','Protect commitments, explain trade-offs and make changes reviewable.'),
           ('5','Are we honest about evidence and source access?','A link is not a read document; a short test is not proof of exam readiness.')]
for i,(n,t,b) in enumerate(questions):
    y=263+i*95
    para(n,44,y,35,18,BLUE,True)
    para(t,91,y,585,14,INK,True)
    para(b,91,y+42,585,11,MUTED)
para('Meeting takeaway',44,760,632,12,BLUE,True)
para('Roadmap turns learning context into a realistic week, then uses actual learning and practice evidence to guide the next one.',44,788,632,16,INK,True)

C.save()
print(OUT / 'Roadmap-Product-and-Workflow-Guide.pdf')
print(f'{page_no} pages generated')
