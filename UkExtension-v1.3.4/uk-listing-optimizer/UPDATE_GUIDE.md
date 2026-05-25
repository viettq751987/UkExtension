# Hướng dẫn thiết lập hệ thống Auto-Update

## Cách hoạt động

```
Extension (Chrome)
    │
    ├─ Mỗi 12 giờ → fetch update_manifest.json từ GitHub
    │
    ├─ So sánh version hiện tại với version trong file
    │
    ├─ Nếu có bản mới → hiện badge "NEW" + banner trong popup
    │
    └─ User click Download → tải ZIP → cài thủ công (Load unpacked)
```

**Tại sao phải cài thủ công?**  
Chrome chỉ cho phép tự động update qua Chrome Web Store. Extension load bằng "Load unpacked" (developer mode) phải update tay — nhưng hệ thống này tự động phát hiện, thông báo, và hướng dẫn từng bước.

---

## Thiết lập (5 phút)

### Bước 1: Tạo GitHub repo

```bash
git init uk-listing-optimizer
cd uk-listing-optimizer
git remote add origin https://github.com/viettq751987/UkExtension.git
```

### Bước 2: Upload file cần thiết lên GitHub

Chỉ cần 1 file trên repo **public**:
```
uk-listing-optimizer/
└── update_manifest.json   ← File này phải public
```

### Bước 3: Sửa URL trong background.js

```js
// background.js — dòng 7
const UPDATE_CHECK_URL =
  'https://raw.githubusercontent.com/viettq751987/UkExtension/main/update_manifest.json';
//                         ↑ Thay YOUR_USERNAME
```

### Bước 4: Khi release bản mới

1. Build và zip extension → `uk-listing-optimizer-v1.0.2.zip`
2. Tạo GitHub Release với tag `v1.0.2`, upload file ZIP
3. Cập nhật `update_manifest.json`:

```json
{
  "version": "1.0.2",
  "releaseDate": "2026-05-25",
  "critical": false,
  "minVersion": null,
  "downloadUrl": "https://github.com/viettq751987/UkExtension/releases/download/v1.0.2/uk-listing-optimizer-v1.0.2.zip",
  "changelogUrl": "https://github.com/viettq751987/UkExtension/releases/tag/v1.0.2",
  "changelog": [
    "Fix: ...",
    "Thêm: ..."
  ]
}
```

4. Push lên GitHub — extension sẽ tự phát hiện trong vòng 12 giờ.

---

## Các trường trong update_manifest.json

| Trường | Mô tả | Ví dụ |
|--------|-------|-------|
| `version` | Version mới | `"1.0.2"` |
| `releaseDate` | Ngày phát hành | `"2026-05-25"` |
| `critical` | Cập nhật khẩn cấp (badge đỏ) | `false` |
| `minVersion` | Version tối thiểu bắt buộc | `"1.0.0"` hoặc `null` |
| `downloadUrl` | Link tải ZIP | GitHub Release URL |
| `changelog` | Danh sách thay đổi | `["Fix: ...", "Thêm: ..."]` |

### `critical: true` — khi nào dùng?
- Có lỗi bảo mật nghiêm trọng  
- Amazon thay đổi DOM khiến scraper hỏng hoàn toàn  
- API endpoint thay đổi

### `minVersion` — force update
Nếu set `"minVersion": "1.0.1"`, user đang dùng `v1.0.0` sẽ thấy cảnh báo **"Bắt buộc cập nhật"** và không thể dismiss.

---

## UI States

| Trạng thái | Badge | Banner | Màu |
|-----------|-------|--------|-----|
| Không có update | — | Ẩn | — |
| Có update thường | `NEW` (vàng) | Xuất hiện | Vàng |
| Critical update | `UPD!` (đỏ) | Xuất hiện, không dismiss được | Đỏ |
| Force update | `UPD!` (đỏ) | Không có nút "Nhắc sau" | Đỏ |

