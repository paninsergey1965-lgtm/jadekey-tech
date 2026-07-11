with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()
with open('newsection.html', 'r', encoding='utf-8') as f:
    section = f.read()
content = content.replace('</body>', section + '\n</body>')
with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)
print("Done")
