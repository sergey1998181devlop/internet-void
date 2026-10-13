// Viral phrases for the share sheet — one bank per site language, so the
// post is always written in the language the visitor picked.
//
// Tokens: {link} = origin + /?ref=share, {item} = the sacrificed text.

export const PHRASE_CATEGORIES = [
  { id: 'catharsis', key: 'phraseCatA' },
  { id: 'mystery', key: 'phraseCatB' },
  { id: 'short', key: 'phraseCatC' },
];

const EN = {
  catharsis: [
    'I burned my memories in the Void forever. They no longer exist in this world.',
    'Erased from reality. The Singularity just swallowed my secret.',
    'Burned the past for the future. The Void accepted my sacrifice. #TheInternetVoid',
    'Some things must dissolve forever. There is no way back.',
  ],
  mystery: [
    'I just fed part of my energy to the Void. Try to get it back if you can: {link}',
    'Matter destroyed. Code discarded. The Singularity grows stronger with every throw.',
    'I made a sacrifice and logged the failure. What will you give when the Void looks back at you?',
    '[ERROR: ITEM DISSOLVED]. I broke the simulation. Join the Observers: {link}',
  ],
  short: [
    'Burned. Forgot. Freed. 🕳️',
    'The Singularity is hungry. Goodbye, {item}.',
    'My sacrifice is accepted. The Singularity is reaching critical mass.',
  ],
};

export const PHRASES = {
  en: EN,
  ru: {
    catharsis: [
      'Я навсегда сжёг свои воспоминания в Бездне. Их больше нет в этом мире.',
      'Стёрто из реальности. Мой секрет только что поглотила Сингулярность.',
      'Сжёг прошлое ради будущего. Бездна приняла мою жертву. #TheInternetVoid',
      'Некоторые вещи должны раствориться навсегда. Назад пути нет.',
    ],
    mystery: [
      'Я только что отдал часть своей энергии Бездне. Попробуй достать это обратно, если сможешь: {link}',
      'Материя уничтожена. Код сброшен. Сингулярность становится сильнее с каждым броском.',
      'Я принес жертву и зафиксировал сбой. Что отдашь ты, когда Бездна взглянет на тебя?',
      '[ERROR: ITEM DISSOLVED]. Я пробил симуляцию. Присоединяйся к Наблюдателям: {link}',
    ],
    short: [
      'Сжёг. Забыл. Освободился. 🕳️',
      'Сингулярность голодна. Прощай, {item}.',
      'Моя жертва принята. Сингулярность накапливает критическую массу.',
    ],
  },
  es: {
    catharsis: [
      'Quemé mis recuerdos en el Vacío para siempre. Ya no existen en este mundo.',
      'Borrado de la realidad. La Singularidad acaba de engullir mi secreto.',
      'Quemé el pasado por el futuro. El Vacío aceptó mi sacrificio. #TheInternetVoid',
      'Algunas cosas deben disolverse para siempre. No hay vuelta atrás.',
    ],
    mystery: [
      'Acabo de entregar parte de mi energía al Vacío. Intenta recuperarla si puedes: {link}',
      'Materia destruida. Código descartado. La Singularidad se fortalece con cada lanzamiento.',
      'Hice un sacrificio y registré el fallo. ¿Qué darás cuando el Vacío te mire?',
      '[ERROR: ITEM DISSOLVED]. Rompí la simulación. Únete a los Observadores: {link}',
    ],
    short: [
      'Quemado. Olvidado. Liberado. 🕳️',
      'La Singularidad tiene hambre. Adiós, {item}.',
      'Mi sacrificio fue aceptado. La Singularidad alcanza masa crítica.',
    ],
  },
  zh: {
    catharsis: [
      '我已将回忆永远焚毁于虚空之中。它们不复存在于这个世界。',
      '从现实中抹除。奇点刚刚吞噬了我的秘密。',
      '为未来焚毁过去。虚空接受了我的献祭。#TheInternetVoid',
      '有些东西必须永远消散。已无回头之路。',
    ],
    mystery: [
      '我刚把一部分能量交给了虚空。有本事就试着拿回去：{link}',
      '物质已毁，代码已弃。每一次投入都让奇点更加强大。',
      '我献上祭品并记录了这次故障。当虚空回望你时，你会献出什么？',
      '[ERROR: ITEM DISSOLVED]. 我击穿了模拟。加入观察者：{link}',
    ],
    short: [
      '焚毁。遗忘。解脱。🕳️',
      '奇点饥肠辘辘。再见，{item}。',
      '我的献祭已被接受。奇点正在逼近临界质量。',
    ],
  },
  ja: {
    catharsis: [
      '私は記憶を虚空に永遠に焼いた。もうこの世界には存在しない。',
      '現実から消された。私の秘密をシリングゥリティが飲み込んだ。',
      '過去を焼き、未来を得た。虚空は私の犠牲を受け入れた。#TheInternetVoid',
      'いくつかのものは永遠に溶け去るべきだ。戻る道はない。',
    ],
    mystery: [
      '今、私のエネルギーの一部を虚空に捧げた。取り戻せるものなら取り戻してみろ：{link}',
      '物質は破壊された。コードは破棄された。投げるたびにシリングゥリティは強くなる。',
      '犠牲を捧げ、故障を記録した。虚空が君を見返すとき、何を捧げる？',
      '[ERROR: ITEM DISSOLVED]. シミュレーションを突破した。オブザーバーに入隊せよ：{link}',
    ],
    short: [
      '焼いた。忘れた。自由になった。🕳️',
      'シリングゥリティは飢えている。さよなら、{item}。',
      '犠牲は受理された。シリングゥリティは臨界質量に近づいている。',
    ],
  },
  de: {
    catharsis: [
      'Ich habe meine Erinnerungen für immer in der Leere verbrannt. Sie existieren nicht mehr.',
      'Aus der Realität gelöscht. Die Singularität hat gerade mein Geheimnis geschluckt.',
      'Vergangenheit für die Zukunft verbrannt. Die Leere hat mein Opfer angenommen. #TheInternetVoid',
      'Manche Dinge müssen für immer verschwinden. Es gibt kein Zurück.',
    ],
    mystery: [
      'Ich habe gerade einen Teil meiner Energie der Leere gegeben. Hol sie zurück, wenn du kannst: {link}',
      'Materie zerstört. Code verworfen. Die Singularität wird mit jedem Wurf stärker.',
      'Ich habe ein Opfer gebracht und den Fehler protokolliert. Was gibst du, wenn die Leere dich ansieht?',
      '[ERROR: ITEM DISSOLVED]. Ich habe die Simulation geknackt. Tritt den Beobachtern bei: {link}',
    ],
    short: [
      'Verbrannt. Vergessen. Frei. 🕳️',
      'Die Singularität hat Hunger. Lebe wohl, {item}.',
      'Mein Opfer wurde angenommen. Die Singularität erreicht kritische Masse.',
    ],
  },
};

export function bankFor(lang) {
  const code = String(lang || 'en').toLowerCase().slice(0, 2);
  return PHRASES[code] || PHRASES.en;
}

export function shareUrl() {
  if (typeof window === 'undefined') return 'https://theinternetvoid.com';
  return window.location.origin + '/?ref=share';
}

export function pickPhrase(category, { item = '', link = shareUrl(), lang = 'en' } = {}) {
  const bank = bankFor(lang);
  const list = bank[category] || bank.catharsis || EN.catharsis;
  const raw = list[Math.floor(Math.random() * list.length)];
  return raw.replace('{link}', link).replace('{item}', item || 'unknown object');
}
