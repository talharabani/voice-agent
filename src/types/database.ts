export type SentimentType = "positive" | "neutral" | "negative";
export type KnowledgeDocType = "pdf" | "docx" | "txt" | "url" | "faq" | "note";

export type UserRow = {
  id: string;
  clerk_id: string;
  email: string;
  name: string | null;
  plan: string;
  created_at: string;
};

export type AgentRow = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  system_prompt: string | null;
  voice: string;
  language: string;
  greeting: string | null;
  is_active: boolean;
  business_type: string | null;
  timezone: string;
  share_token: string;
  created_at: string;
  updated_at: string;
};

export type ConversationRow = {
  id: string;
  call_sid: string | null;
  agent_id: string;
  user_id: string;
  transcript: Record<string, unknown>[];
  duration_seconds: number | null;
  sentiment: SentimentType | null;
  lead_score: number;
  intent: string | null;
  status: string;
  created_at: string;
};

export type LeadRow = {
  id: string;
  user_id: string;
  agent_id: string;
  conversation_id: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  tags: string[];
  status: string;
  notes: string | null;
  lead_score: number;
  created_at: string;
};

export type AppointmentStatus = "requested" | "confirmed" | "completed" | "cancelled";

export type AppointmentRow = {
  id: string;
  user_id: string;
  agent_id: string;
  conversation_id: string | null;
  lead_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  service: string | null;
  requested_time: string | null;
  scheduled_at: string | null;
  status: AppointmentStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type PhoneNumberRow = {
  id: string;
  user_id: string;
  agent_id: string | null;
  phone_number: string;
  provider: string;
  created_at: string;
};

export type KnowledgeDocRow = {
  id: string;
  agent_id: string;
  type: KnowledgeDocType;
  name: string;
  content: string | null;
  url: string | null;
  created_at: string;
};

export interface Database {
  public: {
    Tables: {
      users: {
        Row: UserRow;
        Insert: Partial<UserRow> & { clerk_id: string; email: string };
        Update: Partial<UserRow>;
        Relationships: [];
      };
      agents: {
        Row: AgentRow;
        Insert: Partial<AgentRow> & { user_id: string; name: string };
        Update: Partial<AgentRow>;
        Relationships: [];
      };
      conversations: {
        Row: ConversationRow;
        Insert: Partial<ConversationRow> & { agent_id: string; user_id: string };
        Update: Partial<ConversationRow>;
        Relationships: [];
      };
      leads: {
        Row: LeadRow;
        Insert: Partial<LeadRow> & { user_id: string; agent_id: string };
        Update: Partial<LeadRow>;
        Relationships: [];
      };
      appointments: {
        Row: AppointmentRow;
        Insert: Partial<AppointmentRow> & { user_id: string; agent_id: string };
        Update: Partial<AppointmentRow>;
        Relationships: [];
      };
      phone_numbers: {
        Row: PhoneNumberRow;
        Insert: Partial<PhoneNumberRow> & { user_id: string; phone_number: string };
        Update: Partial<PhoneNumberRow>;
        Relationships: [];
      };
      knowledge_docs: {
        Row: KnowledgeDocRow;
        Insert: Partial<KnowledgeDocRow> & {
          agent_id: string;
          type: KnowledgeDocType;
          name: string;
        };
        Update: Partial<KnowledgeDocRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
