type DatabaseError = {
  code?: string | null;
  message?: string | null;
};

export function mapTbosTeamMutationError(error: DatabaseError) {
  const message = error.message || "";

  if (error.code === "23505") {
    return { status: 409, message: "Nama tim sudah dipakai pada batch ini. Gunakan nama lain." };
  }

  if (error.code === "23514") {
    if (/batch/i.test(message)) {
      return { status: 409, message: "Batch tidak cocok dengan program atau belum memakai skema batch terbaru." };
    }
    return { status: 400, message: "Data tim tidak memenuhi aturan yang berlaku." };
  }

  if (error.code === "23503") {
    return { status: 400, message: "Batch, program, atau organisasi yang dipilih tidak ditemukan." };
  }

  if (error.code === "22023") {
    return { status: 400, message: message || "Data tim tidak valid." };
  }

  return { status: 500, message: "Tim belum dapat disimpan. Coba lagi atau hubungi administrator." };
}
