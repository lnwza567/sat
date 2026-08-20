// 1. แม่แบบข้อมูลงาน (Data Model)
class Task {
    constructor(subject, title, deadline, status = "Pending") {
        this.subject = subject.trim();
        this.title = title.trim();
        this.deadline = deadline;
        this.status = status;
    }
}

// 2. ตัวจัดการฐานข้อมูล (DB Manager)
class SheetAPI {
    constructor(url) {
        this.url = url;
    }

    async request(payload = null) {
        const options = payload
            ? {
                method: "POST",
                body: JSON.stringify(payload)
            }
            : {};

        const response = await fetch(this.url, options);

        if (!response.ok) {
            throw new Error(`HTTP error: ${response.status}`);
        }

        const result = await response.json();

        if (result.status === "error") {
            throw new Error(
                result.message || "เกิดข้อผิดพลาดจาก Google Apps Script"
            );
        }

        return result;
    }

    async fetchTasks() {
        const result = await this.request();
        return Array.isArray(result) ? result : (result.data || []);
    }

    async addTask(task) {
        return await this.request({
            action: "add",
            ...task
        });
    }

    async updateTask(id, task) {
        return await this.request({
            action: "updateTask",
            id,
            ...task
        });
    }

    async updateStatus(id, newStatus) {
        return await this.request({
            action: "updateStatus",
            id,
            status: newStatus
        });
    }

    async deleteTask(id) {
        return await this.request({
            action: "delete",
            id
        });
    }
}

// ใส่ URL Web App ที่ได้จาก Google Apps Script หลัง Deploy
const api = new SheetAPI("https://script.google.com/macros/s/AKfycbx6eyuudcowdp4LjMpgCoXpyaRk6gsrLSrMSBfSI3RiTn0B2Ywc9Eeb7GjIqJBFsh-FwQ/exec");

const listArea = document.getElementById("task-list");
const subjectInput = document.getElementById("subject");
const titleInput = document.getElementById("title");
const deadlineInput = document.getElementById("deadline");
const addButton = document.getElementById("add-btn");

// องค์ประกอบภายใน Material Modal
const editModal = document.getElementById("edit-modal");
const editForm = document.getElementById("edit-form");
const editSubjectInput = document.getElementById("edit-subject");
const editTitleInput = document.getElementById("edit-title");
const editDeadlineInput = document.getElementById("edit-deadline");
const cancelEditButton = document.getElementById("cancel-edit-btn");
const closeEditButton = document.getElementById("close-edit-btn");
const confirmEditButton = document.getElementById("confirm-edit-btn");

let lastFocusedElement = null;

let taskCache = [];
let editingTaskId = null;
let editingTaskStatus = "Pending";

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

// แปลงวันที่ให้เป็น YYYY-MM-DD ซึ่ง input type="date" รองรับ
function normalizeDateForInput(value) {
    if (!value) return "";

    const dateText = String(value).trim();

    // รองรับรูปแบบ YYYY-MM-DD โดยตรง
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
        return dateText;
    }

    // รองรับรูปแบบ DD/MM/YYYY
    const slashMatch = dateText.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
        const [, day, month, year] = slashMatch;
        return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }

    // รองรับวันที่ที่ JavaScript สามารถอ่านได้
    const parsedDate = new Date(dateText);
    if (!Number.isNaN(parsedDate.getTime())) {
        const year = parsedDate.getFullYear();
        const month = String(parsedDate.getMonth() + 1).padStart(2, "0");
        const day = String(parsedDate.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    return "";
}

function formatThaiDate(value) {
    const normalized = normalizeDateForInput(value);
    if (!normalized) return value || "-";

    const [year, month, day] = normalized.split("-").map(Number);
    const date = new Date(year, month - 1, day);

    return new Intl.DateTimeFormat("th-TH", {
        day: "numeric",
        month: "long",
        year: "numeric"
    }).format(date);
}

function clearForm() {
    subjectInput.value = "";
    titleInput.value = "";
    deadlineInput.value = "";
    subjectInput.focus();
}

function validateTask(task) {
    if (!task.subject || !task.title || !task.deadline) {
        alert("กรุณากรอกวิชา ชื่องาน และกำหนดส่งให้ครบ");
        return false;
    }

    return true;
}

function openEditModal() {
    lastFocusedElement = document.activeElement;
    editModal.classList.add("is-open");
    editModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");

    requestAnimationFrame(() => {
        editSubjectInput.focus();
    });
}

function closeEditModal() {
    editModal.classList.remove("is-open");
    editModal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");

    editingTaskId = null;
    editingTaskStatus = "Pending";
    editForm.reset();

    if (lastFocusedElement) {
        lastFocusedElement.focus();
        lastFocusedElement = null;
    }
}

async function runAction(action, busyText = "กำลังดำเนินการ...") {
    const oldText = addButton.textContent;
    addButton.disabled = true;
    addButton.textContent = busyText;

    try {
        await action();
    } catch (error) {
        console.error(error);
        alert(`เกิดข้อผิดพลาด: ${error.message}`);
    } finally {
        addButton.disabled = false;
        addButton.textContent = oldText;
    }
}

async function render() {
    listArea.innerHTML = "<p>กำลังโหลดข้อมูล...</p>";

    try {
        const tasks = await api.fetchTasks();
        taskCache = tasks;
        listArea.innerHTML = "";

        if (tasks.length === 0) {
            listArea.innerHTML = "<p>ยังไม่มีรายการงาน</p>";
            return;
        }

        tasks.forEach((task) => {
            const card = document.createElement("article");
            card.className =
                task.status === "Completed"
                    ? "task-card completed"
                    : "task-card";

            const nextStatus =
                task.status === "Completed" ? "Pending" : "Completed";

            const statusText =
                task.status === "Completed"
                    ? "✅ เสร็จแล้ว"
                    : "⏳ กำลังทำ";

            card.innerHTML = `
                <div>
                    <h3>${escapeHTML(task.title)}</h3>
                    <p>
                        วิชา: ${escapeHTML(task.subject)}
                        | ส่ง: ${escapeHTML(formatThaiDate(task.deadline))}
                    </p>
                </div>
                <div>
                    <button
                        type="button"
                        onclick="changeStatus('${task.id}', '${nextStatus}')"
                    >
                        ${statusText}
                    </button>
                    <button
                        type="button"
                        onclick="editTask('${task.id}')"
                    >
                        ✏️ แก้ไข
                    </button>
                    <button
                        type="button"
                        onclick="removeTask('${task.id}')"
                    >
                        🗑️ ลบ
                    </button>
                </div>
            `;

            listArea.appendChild(card);
        });
    } catch (error) {
        console.error(error);
        listArea.innerHTML =
            `<p>โหลดข้อมูลไม่สำเร็จ: ${escapeHTML(error.message)}</p>`;
    }
}

addButton.addEventListener("click", async () => {
    const newTask = new Task(
        subjectInput.value,
        titleInput.value,
        deadlineInput.value
    );

    if (!validateTask(newTask)) return;

    await runAction(async () => {
        await api.addTask(newTask);
        clearForm();
        await render();
    }, "กำลังเพิ่มข้อมูล...");
});

window.changeStatus = async (id, newStatus) => {
    try {
        await api.updateStatus(id, newStatus);
        await render();
    } catch (error) {
        console.error(error);
        alert(`เปลี่ยนสถานะไม่สำเร็จ: ${error.message}`);
    }
};

// เปิด Popup และใส่ข้อมูลเดิมลงในทุกช่อง
window.editTask = (id) => {
    const currentTask = taskCache.find(
        (task) => String(task.id) === String(id)
    );

    if (!currentTask) {
        alert("ไม่พบรายการที่ต้องการแก้ไข");
        return;
    }

    editingTaskId = currentTask.id;
    editingTaskStatus = currentTask.status || "Pending";

    editSubjectInput.value = currentTask.subject || "";
    editTitleInput.value = currentTask.title || "";
    editDeadlineInput.value = normalizeDateForInput(
        currentTask.deadline
    );

    openEditModal();
};

// ปิด Modal ด้วยปุ่มยกเลิกหรือปุ่ม X
cancelEditButton.addEventListener("click", closeEditModal);
closeEditButton.addEventListener("click", closeEditModal);

// ปิด Modal เมื่อคลิกพื้นที่ด้านนอก
editModal.addEventListener("click", (event) => {
    if (event.target.matches("[data-modal-close]")) {
        closeEditModal();
    }
});

// ปิด Modal ด้วยปุ่ม Escape
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && editModal.classList.contains("is-open")) {
        closeEditModal();
    }
});

// ปุ่มยืนยัน: บันทึกทั้ง 3 ช่องพร้อมกัน
editForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!editingTaskId) {
        alert("ไม่พบ ID ของรายการที่กำลังแก้ไข");
        return;
    }

    const updatedTask = new Task(
        editSubjectInput.value,
        editTitleInput.value,
        editDeadlineInput.value,
        editingTaskStatus
    );

    if (!validateTask(updatedTask)) return;

    const originalText = confirmEditButton.textContent;
    confirmEditButton.disabled = true;
    cancelEditButton.disabled = true;
    confirmEditButton.textContent = "กำลังบันทึก...";

    try {
        await api.updateTask(editingTaskId, updatedTask);
        closeEditModal();
        await render();
    } catch (error) {
        console.error(error);
        alert(`แก้ไขข้อมูลไม่สำเร็จ: ${error.message}`);
    } finally {
        confirmEditButton.disabled = false;
        cancelEditButton.disabled = false;
        confirmEditButton.textContent = originalText;
    }
});

window.removeTask = async (id) => {
    const confirmed = confirm("ยืนยันการลบรายการงานนี้หรือไม่?");
    if (!confirmed) return;

    try {
        await api.deleteTask(id);
        await render();
    } catch (error) {
        console.error(error);
        alert(`ลบข้อมูลไม่สำเร็จ: ${error.message}`);
    }
};

render();