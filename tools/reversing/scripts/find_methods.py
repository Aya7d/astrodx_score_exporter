import struct
import os

script_dir = os.path.dirname(os.path.abspath(__file__))
metadata_paths = [
    os.path.join(script_dir, '..', 'dumps', 'global-metadata.dat'),
    os.path.join(script_dir, 'global-metadata.dat'),
    'global-metadata.dat'
]
metadata_file = next((p for p in metadata_paths if os.path.exists(p)), 'global-metadata.dat')

with open(metadata_file, 'rb') as f:
    f.seek(2867420)
    data = f.read(2772840)
    f.seek(601160)
    str_table = f.read(1875254)

method_count = len(data) // 30
print(f'Total methods: {method_count}')

matches = []
for i in range(method_count):
    entry = data[i*30 : (i+1)*30]
    name_idx = struct.unpack('<I', entry[:4])[0]
    if name_idx < len(str_table):
        end = str_table.find(b'\x00', name_idx)
        s = str_table[name_idx:end]
        s_lower = s.lower()
        if b'aes' in s_lower or b'reflekt' in s_lower or b'decrypt' in s_lower:
            matches.append((i, name_idx, s.decode('latin1', errors='replace')))

for m in matches:
    print(f'Method {m[0]}: name_idx={m[1]}, name={m[2]}')
