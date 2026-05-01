import { supabase } from "./supabase.js";

export async function fetchBookmarks(userId) {
  const { data, error } = await supabase
    .from("bookmarks")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function addBookmark({ userId, problemName, difficulty, tags = [], note = "" }) {
  const { error } = await supabase.from("bookmarks").upsert({
    user_id: userId,
    problem_name: problemName,
    difficulty,
    tags,
    note,
  });
  if (error) throw error;
}

export async function removeBookmark({ userId, problemName }) {
  const { error } = await supabase
    .from("bookmarks")
    .delete()
    .eq("user_id", userId)
    .eq("problem_name", problemName);
  if (error) throw error;
}

export async function isBookmarked({ userId, problemName }) {
  const { data } = await supabase
    .from("bookmarks")
    .select("id")
    .eq("user_id", userId)
    .eq("problem_name", problemName)
    .maybeSingle();
  return !!data;
}
