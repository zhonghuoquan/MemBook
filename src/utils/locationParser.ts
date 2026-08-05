/**
 * BigDataCloud 逆地理编码响应解析
 * 前后端（Rust）逻辑保持一致，输出统一层级字符串：省-市-区县-街道-社区
 */

const MUNICIPALITIES = ['北京', '北京市', '上海', '上海市', '天津', '天津市', '重庆', '重庆市'];

function isMunicipality(name: string): boolean {
  return MUNICIPALITIES.includes(name);
}

function normalizeName(name: string): string {
  const s = name.trim();
  // 去掉无意义的"市辖区"后缀
  if (s.endsWith('市辖区') && s.length > 3) {
    return s.slice(0, s.length - 3).trim();
  }
  return s;
}

export function parseBigDataCloudLocation(data: any): string | null {
  if (!data || typeof data !== 'object') return null;

  let province = (data.principalSubdivision || '').trim();
  let city = (data.city || data.locality || '').trim();
  let district = (data.district || '').trim();
  let street = (data.street || data.suburb || '').trim();
  let subLocality = '';

  const admins = data.localityInfo?.administrative ?? [];
  for (const a of admins) {
    const level = a?.adminLevel;
    const name = (a?.name || '').trim();
    if (!name) continue;
    if ((level === 2 || level === 3) && !province) province = name;
    else if ((level === 4 || level === 5) && !city) city = name;
    else if (level === 6 && !district) district = name;
    else if (level === 7 && !street) street = name;
    else if (level === 8 && !subLocality) subLocality = name;
  }

  const parts: string[] = [];
  const addPart = (name: string) => {
    const n = normalizeName(name);
    if (!n) return;
    const last = parts[parts.length - 1];
    if (last && (last === n || last.includes(n) || n.includes(last))) return;
    parts.push(n);
  };

  if (province && !isMunicipality(province)) addPart(province);
  if (city) {
    if (isMunicipality(city) && !province) addPart(city);
    else if (!isMunicipality(city)) addPart(city);
  }
  if (district) addPart(district);
  if (street) addPart(street);
  if (subLocality && subLocality !== street) addPart(subLocality);

  if (parts.length > 0) return parts.join('-');
  return data.locality || data.city || null;
}
