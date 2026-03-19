const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../public');
const files = ['index.html', 'devices.html', 'device.html', 'alerts.html', 'forecast.html', 'admin.html'];

files.forEach(f => {
    let content = fs.readFileSync(path.join(dir, f), 'utf8');
    
    // Inject Account Nav before Admin Nav if it doesn't already exist
    if (!content.includes('account.html" class="nav-item"')) {
        content = content.replace(
            /<a href="admin\.html"/, 
            '<a href="account.html" class="nav-item"><i class="ph ph-user-circle"></i><span>Account</span></a>\n                <a href="admin.html"'
        );
        fs.writeFileSync(path.join(dir, f), content);
    }
});
console.log('Account link restored to HTML files');
