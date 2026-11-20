/**
 * 汉字 Unicode 扩展区与旧版 Minecraft 点阵字体渲染风险检测。
 *
 * MC 1.7.10 / 1.12.2 的 FontRenderer 按 UTF-16 `char` 处理并依赖旧版 UniFont 位图：
 * - 非 BMP（U+20000–U+3FFFF，CJK 扩展 B–I）会拆成代理对，旧版游戏直接渲染为方框；
 * - BMP 新增汉字区（U+9FA6–U+9FFF，Unicode 4.1–15.1，如「鿬」「鿫」）在旧版点阵字体中普遍缺字；
 * - CJK 扩展 A（U+3400–U+4DBF，如「䥑」）与兼容表意区（U+F900–U+FAFF）在部分精简/像素字体中也存在缺字风险。
 */

export type UnicodeRiskLevel = 'high' | 'medium';

export interface UnicodeRiskChar {
  char: string;
  codePoint: string;
  block: string;
  level: UnicodeRiskLevel;
  reason: string;
}

export function detectUnicodeRisks(text: string): UnicodeRiskChar[] {
  const seen = new Set<string>();
  const risks: UnicodeRiskChar[] = [];

  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    const codePoint = `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
    if (seen.has(codePoint)) continue;

    if (cp > 0xffff) {
      seen.add(codePoint);
      risks.push({
        char: ch,
        codePoint,
        block: 'CJK 扩展 B–I（非 BMP）',
        level: 'high',
        reason: '非 BMP 字符（UTF-16 代理对），旧版 MC（1.7.10/1.12.2）点阵字体无法渲染',
      });
    } else if (cp >= 0x9fa6 && cp <= 0x9fff) {
      seen.add(codePoint);
      risks.push({
        char: ch,
        codePoint,
        block: 'BMP 新增汉字区 (U+9FA6–U+9FFF)',
        level: 'high',
        reason: 'Unicode 4.1–15.1 新增汉字，旧版 MC 与传统点阵字体普遍缺字',
      });
    } else if (cp >= 0x3400 && cp <= 0x4dbf) {
      seen.add(codePoint);
      risks.push({
        char: ch,
        codePoint,
        block: 'CJK 扩展 A (U+3400–U+4DBF)',
        level: 'medium',
        reason: 'CJK 扩展 A 生僻字，部分像素或精简字体可能缺字',
      });
    } else if (cp >= 0xf900 && cp <= 0xfaff) {
      seen.add(codePoint);
      risks.push({
        char: ch,
        codePoint,
        block: 'CJK 兼容表意区 (U+F900–U+FAFF)',
        level: 'medium',
        reason: 'CJK 兼容码位，建议使用对应规范统一表意文字',
      });
    }
  }

  return risks;
}
