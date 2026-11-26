// Curated study layer on top of the user's own imported script.
// Only short key phrases live here; full dialogue comes from the user's PDF.

export const ACTS = [
  { n: 1, ko: '1막 · 외로움', en: 'Loneliness' },
  { n: 2, ko: '2막 · 만남', en: 'Meeting Samantha' },
  { n: 3, ko: '3막 · 사랑에 빠지다', en: 'Falling' },
  { n: 4, ko: '4막 · 균열', en: 'Cracks' },
  { n: 5, ko: '5막 · 확장과 이별', en: 'Expansion & Goodbye' },
];

// Key scenes: matched to parsed scenes by script page (±1) and heading keyword.
export const KEY_SCENES = [
  { page: 1, match: 'UNKNOWN SPACE', ko: '오프닝 — 50주년 편지 대필' },
  { page: 3, match: 'EARLY EVENING', ko: 'Paul과 퇴근 인사' },
  { page: 4, match: 'LOS ANGELES STREET', ko: '퇴근길 이메일 확인' },
  { page: 6, match: 'TINY BEDROOM', ko: 'Catherine과의 플래시백' },
  { page: 6, match: 'CURRENT BEDROOM', ko: '잠 못 드는 밤, 채팅방' },
  { page: 10, match: 'SUBWAY STATION', ko: 'OS 광고' },
  { page: 10, match: 'HOME OFFICE', ko: 'OS 설치 · Samantha와 첫 대화' },
  { page: 16, match: "OFFICE - DAY", ko: '교정 부탁 · Roger의 편지' },
  { page: 18, match: 'LOBBY', ko: '로비에서 Amy와 Charles' },
  { page: 19, match: 'ELEVATOR', ko: '엘리베이터 — 과일 주스 논쟁' },
  { page: 20, match: 'APARTMENT - EVENING', ko: '게임 · 소개팅 주선' },
  { page: 25, match: "AMY'S APARTMENT", ko: 'Amy의 다큐' },
  { page: 28, match: 'HALLYWAY', ko: '이혼 변호사 메일' },
  { page: 29, match: 'PRE-DAWN', ko: '새벽 대화 — "Get up"' },
  { page: 32, match: 'OUTDOOR MALL', ko: '눈 감고 걷기' },
  { page: 33, match: 'PROMENADE', ko: '사람 관찰 · 몸을 가진 상상' },
  { page: 35, match: 'ASIAN-FUSION', ko: '소개팅' },
  { page: 36, match: 'ASIAN-FUSION', ko: '소개팅 — 취기' },
  { page: 38, match: 'OVERPASS', ko: '소개팅의 끝' },
  { page: 39, match: 'BEDROOM - NIGHT', ko: '그날 밤의 대화' },
  { page: 44, match: 'HOME OFFICE', ko: '다음 날 아침의 어색함' },
  { page: 47, match: 'BEACH - DAY', ko: '해변 — 인간의 몸' },
  { page: 49, match: 'SUBWAY TRAIN', ko: '결혼이란' },
  { page: 50, match: "OFFICE - DAY", ko: 'Roberto 편지 · Paul의 칭찬' },
  { page: 52, match: 'ELEVATOR', ko: 'Amy의 이별 소식' },
  { page: 53, match: "AMY'S APARTMENT", ko: 'Amy의 이별 사연' },
  { page: 54, match: 'BEDROOM - NIGHT', ko: '잠들기 전 농담' },
  { page: 55, match: 'LEWMAN', ko: '대녀 Jocelyn' },
  { page: 58, match: "AMY'S OFFICE", ko: 'Amy에게 털어놓기' },
  { page: 62, match: 'CITY', ko: '이혼 서명 계획' },
  { page: 63, match: 'PATIO - DAY', ko: 'Catherine과 재회' },
  { page: 64, match: 'PATIO', ko: 'Catherine과 점심 — 충돌' },
  { page: 66, match: "OFFICE - DAY", ko: '물리학 북클럽 통화' },
  { page: 69, match: 'OFFICE - EVENING', ko: 'Paul과 Tatiana' },
  { page: 70, match: 'LATE AT NIGHT', ko: '대리 파트너 제안' },
  { page: 72, match: 'APARTMENT - NIGHT', ko: 'Isabella' },
  { page: 74, match: 'BEDROOM', ko: 'Isabella — 어긋남' },
  { page: 77, match: 'STREET - NIGHT', ko: '길가의 다툼' },
  { page: 80, match: "AMY'S OFFICE", ko: 'Amy의 조언' },
  { page: 83, match: 'PERFECT MOM', ko: '화해' },
  { page: 84, match: 'PARK', ko: '우리의 사진 같은 음악' },
  { page: 85, match: 'CATALINA', ko: 'Catalina 소풍' },
  { page: 88, match: 'BULLET TRAIN', ko: '기차 퀴즈 · 출판 소식' },
  { page: 92, match: 'MORNING', ko: 'Alan Watts' },
  { page: 95, match: 'BEDROOM', ko: '새벽 전화' },
  { page: 96, match: 'SUBWAY STATION', ko: 'OS Not Found · 8,316과 641' },
  { page: 101, match: 'LATE AFTERNOON', ko: '작별 (1)' },
  { page: 102, match: 'LATE AFTERNOON', ko: '작별 (2) — 단어 사이의 공간' },
  { page: 103, match: 'HALLWAY', ko: 'Amy에게' },
  { page: 104, match: 'APARTMENT - NIGHT', ko: 'Catherine에게 쓰는 편지' },
];

export function annotateScenes(scenes) {
  const used = new Set();
  for (const s of scenes) {
    const k = KEY_SCENES.find((k, i) => !used.has(i) && Math.abs(k.page - s.page) <= 1 && s.heading.includes(k.match));
    if (k) { used.add(KEY_SCENES.indexOf(k)); s.ko = k.ko; s.key = true; }
  }
  return scenes;
}

export const CATEGORIES = [
  '대화 열고 닫기', '챙기기 · 공감', '솔직함 · 경계', '사과 · 회복',
  '격려 · 농담', '감정 · 생각', '문형', '관용구 · 구동사', '날것의 구어',
];

// en: the chunk to say · ko: Korean meaning (spoken in drills) · note: usage tip
// find: lowercase fragment to locate the source line (defaults to en)
const E = (cat, en, ko, note = '', find = '') => ({ cat, en, ko, note, find });

export const EXPRESSIONS = [
  // 대화 열고 닫기
  E(0, "How's it going?", '잘 지내?', '가장 흔한 캐주얼 인사. "Good, you?"로 받으면 끝.'),
  E(0, 'What are you up to?', '뭐 하고 있어?', '지금 하는 일 또는 요즘 근황 둘 다 가능.'),
  E(0, "What's going on with you?", '너는 요즘 어때?', '내 얘기 끝나고 상대에게 공을 넘길 때.'),
  E(0, 'Is now a good time to talk?', '지금 얘기해도 괜찮아?', '전화나 회의 전에 상대 상황 확인.'),
  E(0, "I'm sorry to bother you.", '방해해서 미안해.', '바쁜 사람에게 말 걸 때 쿠션.'),
  E(0, 'Hold on a second.', '잠깐만.', '통화 중 다른 사람 응대할 때도.'),
  E(0, 'I gotta grab this.', '이거 받아야 해.', '전화가 와서 자리 뜰 때. grab = 받다.'),
  E(0, "Don't worry about it. We'll talk later.", '신경 쓰지 마. 나중에 얘기하자.'),
  E(0, 'You sound distracted', '너 정신 딴 데 있는 것 같아.', '목소리로 판단 → sound.'),
  E(0, "Why don't we talk when you get home?", '집에 오면 얘기하는 게 어때?', 'Why don\'t we ~? = ~하자(부드러운 제안).'),
  E(0, 'Maybe we should call it a night.', '오늘은 이만하는 게 좋겠어.', 'call it a night = 그날 일정을 마무리하다.'),
  E(0, 'Gimme a shout back.', '연락 줘.', 'give me a shout = 연락해. 친구 사이 캐주얼.'),
  E(0, "Why didn't you call me back", '왜 전화 안 했어?', 'call back = 답신 전화하다.'),
  E(0, 'Respond later.', '나중에 답장.', '음성 비서 명령. 나 → "I\'ll respond later."'),

  // 챙기기 · 공감
  E(1, 'Is there anything I can do?', '내가 해줄 수 있는 거 있어?'),
  E(1, "How can you tell something's wrong?", '뭔가 잘못된 거 어떻게 알았어?', 'tell = 알아채다, 구별하다.'),
  E(1, "You don't sound like it.", '그렇게 안 들리는데.', '"I\'m fine"에 대한 부드러운 반박.'),
  E(1, 'Is there anything you want to talk about?', '얘기하고 싶은 거 있어?'),
  E(1, "That's too bad.", '안됐다.', '가벼운 위로. 큰 비극엔 "I\'m so sorry".'),
  E(1, "You've been through a lot lately.", '요즘 많은 일을 겪었잖아.', 'go through = 겪다.'),
  E(1, 'I figured you were hungry.', '배고플 것 같았어.', 'figure = 짐작하다.'),
  E(1, "I'm glad to hear that", '그렇다니 다행이다.'),
  E(1, 'You deserve to.', '넌 그럴 자격 있어.'),
  E(1, "I'm happy for you.", '잘됐다, 내가 다 기쁘다.', '상대의 좋은 소식에.'),
  E(1, 'You feel real to me', '나한텐 네가 진짜로 느껴져.'),

  // 솔직함 · 경계
  E(2, 'I want to be up front with you.', '솔직하게 말해두고 싶어.', '불편한 말을 꺼내기 전 예고.'),
  E(2, "I'm not in a place to commit to anything right now.", '지금은 뭔가를 약속할 상황이 아니야.', 'be in a place to ~ = ~할 (정신적) 상태다.'),
  E(2, 'I need some time to think.', '생각할 시간이 필요해.'),
  E(2, "I don't like who I am right now.", '지금 내 모습이 싫어.'),
  E(2, 'It just makes me uncomfortable.', '그냥 좀 불편해.'),
  E(2, "Someone's feelings are bound to get hurt.", '누군가는 분명 상처받을 거야.', 'be bound to ~ = 반드시 ~하게 되어 있다.'),
  E(2, "I'm not ready.", '난 아직 준비가 안 됐어.'),
  E(2, "I can't let you waste my time", '네가 내 시간 낭비하게 둘 순 없어.'),
  E(2, "I don't know what I want", '내가 뭘 원하는지 모르겠어.'),
  E(2, 'This is important to me.', '이건 나한테 중요해.'),

  // 사과 · 회복
  E(3, "I'm sorry, you go first.", '미안, 먼저 말해.', '동시에 말이 겹쳤을 때.'),
  E(3, "No, don't apologize.", '아냐, 사과하지 마.'),
  E(3, "I don't know what's wrong with me.", '나 왜 이러는지 모르겠어.'),
  E(3, "I didn't mean it like that.", '그런 뜻이 아니었어.'),
  E(3, "Don't turn this around on me.", '나한테 덮어씌우지 마.', 'turn ~ around on someone = 책임을 되돌리다.'),
  E(3, 'I want to tell you everything.', '너한테 다 말하고 싶어.'),
  E(3, 'I hope you can accept that.', '네가 그걸 받아들여 줬으면 좋겠어.'),
  E(3, 'I was starting to think I was crazy.', '내가 미친 건가 싶기 시작했어.'),
  E(3, "I don't know if that's completely fair.", '그게 완전히 공정한 말인지는 모르겠어.', '상대 편을 들며 반박할 때.'),
  E(3, "I'm being silly.", '내가 괜히 이러네.'),
  E(3, 'That was a terrible idea.', '그건 최악의 생각이었어.'),

  // 격려 · 농담
  E(4, "You've got nothing to lose.", '밑져야 본전이야.'),
  E(4, "don't back out", '빠지지 마.', 'back out = (약속에서) 발을 빼다.'),
  E(4, "Don't let it get to your head.", '너무 우쭐대지는 마.', 'get to one\'s head = 자만하게 만들다.'),
  E(4, 'Nice try though', '시도는 좋았어.'),
  E(4, 'I walked right into it.', '내가 제 발로 걸려들었네.', '상대 농담에 당했을 때.'),
  E(4, 'You just know me so well already!', '벌써 날 그렇게 잘 알다니!', '반어적 농담.'),
  E(4, 'Is that your final answer?', '그게 최종 답이야?'),
  E(4, 'give me a hint', '힌트 좀 줘.'),
  E(4, 'That sounds about right.', '그럴 것 같더라.', '상대의 자조에 맞장구치는 농담.'),
  E(4, 'Am I doing it again?', '나 또 그러고 있어?', '자기 버릇을 의식할 때.'),
  E(4, "What's the rush?", '뭐가 그렇게 급해?'),
  E(4, "he'd be stupid not to", '안 하면 바보지.'),
  E(4, "you're a good one", '넌 정말 괜찮은 사람이야.'),
  E(4, "You're too funny.", '너 진짜 웃겨.'),
  E(4, "Will do! I've got just the place.", '그럴게! 딱 좋은 데 알아.', 'Will do = (부탁에) 그렇게 할게.'),
  E(4, 'You are insane.', '너 완전 미쳤다.', '친한 사이에서 감탄 섞인 말.'),

  // 감정 · 생각
  E(5, 'I feel like I can say anything to you.', '너한텐 뭐든 말할 수 있을 것 같아.'),
  E(5, "There's a lot more to you than I thought.", '넌 내가 생각했던 것보다 훨씬 깊은 사람이야.'),
  E(5, 'That means a lot to me.', '그 말 정말 큰 힘이 돼.'),
  E(5, 'I keep waiting to not care about her.', '그녀에게 마음이 안 쓰이게 될 날만 계속 기다려.', 'keep -ing = 계속 ~하다.'),
  E(5, "You're your own worst critic", '넌 너 자신한테 제일 가혹해.'),
  E(5, 'The past is just a story we tell ourselves.', '과거는 우리가 스스로에게 들려주는 이야기일 뿐이야.'),
  E(5, 'Does that make me a freak?', '그럼 내가 이상한 사람인 거야?'),
  E(5, "I've never loved anyone the way I love you.", '널 사랑하는 것처럼 누군가를 사랑한 적은 없어.'),
  E(5, "I'm yours and I'm not yours.", '난 네 거이기도 하고 아니기도 해.'),
  E(5, 'I need you to let me go.', '날 보내줘야 해.', 'I need you to ~ = 네가 ~해줘야 해.'),
  E(5, 'I wish I could put my arms around you.', '널 안아줄 수 있으면 좋겠어.', 'I wish I could ~ = ~할 수 있으면 좋을 텐데.'),
  E(5, "I can't believe I'm having this conversation", '내가 이런 대화를 하고 있다니.'),

  // 문형
  E(6, "I've been going in circles for an hour.", '한 시간째 제자리걸음이야.', 'go in circles = 같은 곳만 맴돌다.'),
  E(6, "How long before you're ready to date?", '다시 연애할 준비 되려면 얼마나 걸려?', 'How long before ~? = ~하기까지 얼마나?'),
  E(6, "What's it like to be alive in that room right now?", '지금 그 방에 살아 있다는 건 어떤 느낌이야?', "What's it like to ~? = ~하는 건 어때?"),
  E(6, 'Mind if I look through your hard drive?', '하드 드라이브 좀 봐도 돼?', 'Mind if I ~? = ~해도 될까?'),
  E(6, "I take it from your tone that you're challenging me.", '말투를 보니 나를 시험하는 것 같네.', 'I take it (that) ~ = ~라고 받아들일게/보아하니.'),
  E(6, "it's important to me to do this together", '이걸 함께 하는 게 나한텐 중요해.'),
  E(6, "the thing I've always found frustrating about", '내가 늘 답답하게 느꼈던 건', 'The thing I ~ about X is ... = X에 대해 내가 ~한 점은'),
  E(6, 'I may as well.', '그냥 하는 게 낫겠어.', 'may as well = (딱히 안 할 이유 없으니) 하는 게 낫다.'),
  E(6, "there's something that feels so good about sharing your life with somebody", '누군가와 삶을 나누는 데엔 뭔가 참 좋은 게 있어.'),
  E(6, "I've been trying to figure out how to talk to you about this.", '이걸 어떻게 말해야 할지 계속 고민했어.'),
  E(6, "you don't have to read it out loud", '소리 내서 안 읽어도 돼.'),
  E(6, "I'd love to see what you got sometime.", '언제 네가 만든 거 보고 싶어.', "I'd love to ~ sometime = 언제 꼭 ~하고 싶어."),
  E(6, "We don't need to have a heavy talk", '무거운 얘기 안 해도 돼.'),
  E(6, 'only one major life decision at a time', '인생의 큰 결정은 한 번에 하나씩.'),
  E(6, "It's not where it should be", '아직 원하는 수준은 아니야.'),

  // 관용구 · 구동사
  E(7, 'set you up on a date', '너 소개팅 잡아줬어.', 'set someone up (with) = 소개해 주다.'),
  E(7, 'You can still wallow in your misery', '여전히 슬픔에 빠져 있어도 돼.', 'wallow in = (감정에) 허우적대다.'),
  E(7, 'Charles and I split up.', '찰스랑 나 헤어졌어.', 'split up = (커플이) 갈라서다.'),
  E(7, 'We can get it out of the way.', '해치워 버리자.', 'get ~ out of the way = 귀찮은 일을 먼저 끝내다.'),
  E(7, 'get out of your head', '생각 좀 그만해.', '머릿속에서 나와 = 과하게 생각하지 마.'),
  E(7, 'keeps hitting on', '계속 작업 걸다.', 'hit on someone = 수작 걸다.'),
  E(7, 'if you needed to get back to him', '그에게 답해야 하는지', 'get back to someone = 회신하다.'),
  E(7, 'move forward', '앞으로 나아가다.'),
  E(7, 'checking in', '안부·상황을 확인하다.', 'Just checking in = 그냥 어떤지 확인차.'),
  E(7, "I'd be stoked", '완전 신날 거야.', 'stoked = 엄청 신난(캐주얼).'),
  E(7, "It's a compliment.", '칭찬이야.'),
  E(7, "Don't start, I'm warning you.", '시작하지 마, 경고했다.', '자책하려는 친구를 막을 때.'),
  E(7, "you're kind of nosy", '너 좀 오지랖 넓다.', 'nosy = 남의 일에 참견하는.'),
  E(7, 'a form of socially acceptable insanity', '사회적으로 용인된 일종의 광기.'),
  E(7, "I'm a kook", '내가 좀 괴짜잖아.'),

  // 날것의 구어 (욕설 · 거친 말 포함 — 실제 원어민 톤)
  E(8, 'So fuck it.', '에라 모르겠다.', '고민 끝, 그냥 하자는 결심. 친한 사이 한정.'),
  E(8, 'What the fuck? Where is this coming from?', '뭐야? 갑자기 왜 이래?', 'Where is this coming from? = 이게 어디서 나온 얘기야?'),
  E(8, "That's fucking insane.", '이건 진짜 미친 짓이야.'),
  E(8, 'Get the fuck out of my face.', '꺼져.', '매우 공격적. 듣고 이해하는 용도.'),
  E(8, 'Will you just punch me in the face?', '그냥 내 얼굴 한 대 쳐줄래?', '자책할 때 과장 표현.'),
  E(8, "He's such a little fucker", '그 녀석 진짜 짜증나는 놈이야.', '애증 섞인 욕.'),
  E(8, 'This kid has some problems.', '이 꼬마 문제 좀 있네.'),
  E(8, "You're a really creepy dude.", '너 진짜 소름 끼치는 남자야.'),
  E(8, 'Badass.', '끝내준다.', '칭찬으로 쓰는 속어.'),
  E(8, 'Holy shit. Are you serious?', '헐, 진짜야?', '놀람·기쁨.'),
  E(8, 'is a dick', '재수 없는 놈이야.'),
  E(8, "I'm such an asshole.", '내가 진짜 못됐다.', '자기 말실수를 사과할 때.'),
].map((e, i) => ({ ...e, id: 'e' + (i + 1), cat: CATEGORIES[e.cat] }));

const key = (s) => s.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Link each expression to the first script line that contains it. */
export function linkExpressions(scenes) {
  const lines = [];
  scenes.forEach((s) => s.items.forEach((it, i) => { if (it.t === 'd') lines.push({ scene: s, i, it, k: key(it.text) }); }));
  return EXPRESSIONS.map((e) => {
    const f = key(e.find || e.en);
    const hit = lines.find((l) => l.k.includes(f));
    return hit
      ? { ...e, source: { sceneId: hit.scene.id, index: hit.i, sp: hit.it.sp, text: hit.it.text, page: hit.it.page } }
      : { ...e };
  });
}
