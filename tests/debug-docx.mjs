import { execSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const docxPath = process.argv[2] || 'C:\\Users\\Lenovo\\Downloads\\Arena_Audit_Complete_Roadmap_0_to_100 (1).docx';

console.log('exists:', existsSync(docxPath));
if (existsSync(docxPath)) {
  console.log('size bytes:', readFileSync(docxPath).length);
}

// Extract using PowerShell Expand-Archive (rename to .zip first)
const tmpZip = resolve('arena-roadmap-tmp.zip');
const tmpDir = resolve('arena-roadmap-tmp');
execSync(`copy /Y "${docxPath}" "${tmpZip}"`, { shell: 'cmd.exe' });
try { execSync(`rmdir /s /q "${tmpDir}"`, { shell: 'cmd.exe' }); } catch {}
execSync(`powershell -Command "Expand-Archive -Path '${tmpZip}' -DestinationPath '${tmpDir}' -Force"`, { shell: 'cmd.exe' });

const documentXml = readFileSync(resolve(tmpDir, 'word', 'document.xml'), 'utf-8');

// Extract text from XML: paragraphs -> newlines
const text = documentXml
  .replace(/<\/w:p>/g, '\n')
  .replace(/<w:tab[^>]*\/>/g, '\t')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"');

console.log('=== TEXT LENGTH:', text.length, '===');
console.log(text);
