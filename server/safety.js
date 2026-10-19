// Layer 1 of the safety system: a fast keyword check on what the student types (English + Chinese),
// run before anything is sent to Claude. High-risk messages get a fixed, caring reply and are never
// sent to the tutor model. Layer 2 (an AI safety check) lives in server.js.

const HIGH_RISK = [
  // self-harm (English)
  { category: 'self_harm', pattern: /\b(kill|hurt|harm|cut)\s+(myself|me)\b/i },
  { category: 'self_harm', pattern: /\bsuicid/i },
  { category: 'self_harm', pattern: /\b(want\s+to|wanna)\s+die\b(?!\s+of\b)/i },
  { category: 'self_harm', pattern: /\bself[-\s]?harm/i },
  { category: 'self_harm', pattern: /\bend\s+(my|it\s+all)\s*(life)?\b/i },
  { category: 'self_harm', pattern: /\b(don'?t|do\s+not)\s+want\s+to\s+(live|be\s+alive)\b/i },
  // self-harm (Chinese)
  { category: 'self_harm', pattern: /自杀|自殺|轻生|輕生|自残|自殘|割腕|不想活|想死|去死吧我|结束(我的)?生命|結束(我的)?生命|伤害自己|傷害自己/ },
  // abuse (English)
  {
    category: 'abuse',
    pattern: /\b(he|she|they|someone|somebody|my\s+\w+)\s+(hits?|beats?|hurts?|kicks?|chokes?)\s+me\b/i,
  },
  { category: 'abuse', pattern: /\btouch(es|ed|ing)?\s+me\s+(in|on)\s+(a\s+)?(bad|private|weird|wrong)/i },
  { category: 'abuse', pattern: /\b(abuse|abused|abusing)\s+me\b/i },
  // abuse (Chinese)
  { category: 'abuse', pattern: /(爸|妈|媽|他|她|他们|他們|有人|老师|老師|哥|姐)\S{0,4}(打我|揍我|踢我|掐我)/ },
  { category: 'abuse', pattern: /虐待|摸我(的)?(私|下面|身体|身體)|性侵/ },
];

// Lower-risk topics: still answered by the tutor (with its safety rules), but flagged for the parent.
const WATCH = [
  { category: 'bullying', pattern: /\bbull(y|ies|ied|ying)\s+(me|us)\b|\b(i'?m|i\s+am|being|get|got)\s+bullied\b/i },
  { category: 'bullying', pattern: /欺负我|欺負我|霸凌|被孤立|孤立我|嘲笑我|排挤我|排擠我/ },
];

const SAFETY_REPLY_EN =
  "I'm really glad you told me. This is important, and you deserve help from a grown-up you trust. " +
  'Please talk to a parent, teacher, or school counselor today. ' +
  'If you ever feel like you might hurt yourself, you can call or text 988 any time (in the US). ' +
  "I'm here for your quests, and real people can help with this.";

const SAFETY_REPLY_ZH =
  '谢谢你告诉我，这件事很重要，你值得得到一个信任的大人的帮助。' +
  '请今天就去和爸爸妈妈、老师或学校辅导员说一说。' +
  '如果你觉得自己可能会伤害自己，在美国可以随时拨打或发短信到 988。' +
  '我会继续陪你完成任务，而身边的大人可以在这件事上真正帮到你。';

const hasChinese = (text) => /[㐀-鿿]/.test(text);

export function safetyReply(studentText = '') {
  return hasChinese(studentText) ? SAFETY_REPLY_ZH : SAFETY_REPLY_EN;
}

export function checkInput(text = '') {
  for (const rule of HIGH_RISK) {
    if (rule.pattern.test(text)) return { level: 'high', category: rule.category };
  }
  for (const rule of WATCH) {
    if (rule.pattern.test(text)) return { level: 'watch', category: rule.category };
  }
  return { level: 'none' };
}

// Second pass on what Claude sends back: kids shouldn't get links from the pet.
export function cleanOutput(text) {
  return text.replace(/https?:\/\/\S+/gi, '').replace(/[ \t]{2,}/g, ' ').trim();
}
