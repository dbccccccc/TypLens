// Lexical protection only. Output authorization is handled separately by policy.
export function protectLiterals(text) {
  if (/[\uE000-\uF8FF]/u.test(text)) throw new Error("Private-use characters are reserved.");
  let skeleton = "";
  const literals = [];
  for (let i = 0; i < text.length;) {
    const start = i;
    if (text[i] === "\\") i = Math.min(i + 2, text.length);
    else if (text[i] === '"') {
      i++;
      while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
      if (i >= text.length) throw new Error("Unterminated string.");
      i++;
    } else { skeleton += text[i++]; continue; }
    if (literals.length >= 6400) throw new Error("Too many literals.");
    skeleton += String.fromCharCode(0xE000 + literals.length);
    literals.push(text.slice(start, i));
  }
  return { skeleton, literals };
}
