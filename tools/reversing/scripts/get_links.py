with open(r'C:/Users/weifa/.gemini/antigravity-ide/brain/3681e394-0461-4e5f-8817-fd22ede259f2/.system_generated/steps/360/content.md', 'r', encoding='utf-8') as f:
    text = f.read()

import re
links = re.findall(r'https://github\.com/rodroidmods/il2cpp-dumper-rs/releases/download/[^\s\"\'\)]+', text)
for l in sorted(list(set(links))):
    print(l)
