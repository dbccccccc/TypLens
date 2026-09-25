import {protectLiterals} from './formula-syntax.js';

export const VISUAL_OUTPUT_SCHEMA = 'visual-formula-output-policy-v1';
export const VISUAL_CALLS = new Set(('acute arrow arrow.l attach bb bold breve cal cancel caron cases class dot dot.double dot.triple floor ceil frac frak grave hat limits lr macron mat norm op overbrace overbracket overline root round sans serif sqrt tilde underbrace underbracket underline upright vec abs binom accent '
  +'sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh log ln exp min max lim sup inf det dim gcd mod Pr '
  +'italic mono display inline script sscript scripts '
  +'alpha beta gamma delta epsilon epsilon.alt zeta eta theta iota kappa lambda mu nu xi pi rho sigma tau upsilon phi phi.alt chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega').split(' '));
const LITERALS = ['#center','#left','#none','#right'];

// Shared syntax checks; this does not compile the formula or score correctness.
export function checkVisualFormulaText(text) {
  const reject = reason => ({accepted:false,reason});
  if (typeof text !== 'string' || !text.trim() || [...text].length > 4096) return reject('empty-or-too-long');
  let skeleton;
  try { ({skeleton} = protectLiterals(text)); }
  catch { return reject('invalid-literal'); }
  for (const literal of new Set(skeleton.match(/#[A-Za-z][A-Za-z0-9_.-]*/g) ?? [])) {
    if (!LITERALS.includes(literal)) return reject('forbidden-code-literal');
    const key = literal === '#none' ? 'delim' : 'align';
    const pattern = new RegExp('\\b'+key+'\\s*:\\s*'+literal+'\\b','g');
    if (!pattern.test(skeleton)) return reject('code-literal-context');
    skeleton = skeleton.replace(pattern,key+': ');
  }
  if (/[#$@`{}]/.test(skeleton) || ['//','/*','*/'].some(x=>skeleton.includes(x))) return reject('code-marker');
  const stack = [], pairs = {')':'(',']':'['};
  for (const c of skeleton) {
    if (c === '(' || c === '[') stack.push(c);
    else if (pairs[c] && stack.pop() !== pairs[c]) return reject('unbalanced-delimiters');
  }
  if (stack.length) return reject('unbalanced-delimiters');
  for (const m of skeleton.matchAll(/([A-Za-z][A-Za-z0-9.-]*)\s*\(/g)) {
    if (m[1].length > 1 && !VISUAL_CALLS.has(m[1])) return reject('unapproved-call:'+m[1]);
  }
  return {accepted:true,reason:'policy-passed'};
}
