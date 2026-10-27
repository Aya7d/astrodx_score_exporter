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
    f.seek(7336292)
    b = f.read(32)

print('Hex:', b.hex())
ints = struct.unpack('<8I', b)
print('Ints:', ints)
