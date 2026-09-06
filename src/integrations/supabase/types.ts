export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity: string
          entity_id: string | null
          id: string
          payload: Json
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: string
          payload?: Json
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: string
          payload?: Json
        }
        Relationships: []
      }
      business_entities: {
        Row: {
          city: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          legal_name: string
          notes: string | null
          party_id: string | null
          state_registration: string | null
          tax_id: string | null
          trade_name: string | null
          uf: string | null
          updated_at: string
        }
        Insert: {
          city?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          legal_name: string
          notes?: string | null
          party_id?: string | null
          state_registration?: string | null
          tax_id?: string | null
          trade_name?: string | null
          uf?: string | null
          updated_at?: string
        }
        Update: {
          city?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          legal_name?: string
          notes?: string | null
          party_id?: string | null
          state_registration?: string | null
          tax_id?: string | null
          trade_name?: string | null
          uf?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_entities_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          hero_media_id: string | null
          id: string
          name: string
          parent_id: string | null
          position: number
          published_at: string | null
          seo_description: string | null
          seo_title: string | null
          slug: string
          status: Database["public"]["Enums"]["content_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          hero_media_id?: string | null
          id?: string
          name: string
          parent_id?: string | null
          position?: number
          published_at?: string | null
          seo_description?: string | null
          seo_title?: string | null
          slug: string
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          hero_media_id?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          position?: number
          published_at?: string | null
          seo_description?: string | null
          seo_title?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_hero_media_id_fkey"
            columns: ["hero_media_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      collections: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          hero_media_id: string | null
          id: string
          name: string
          position: number
          published_at: string | null
          seo_description: string | null
          seo_title: string | null
          slug: string
          status: Database["public"]["Enums"]["content_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          hero_media_id?: string | null
          id?: string
          name: string
          position?: number
          published_at?: string | null
          seo_description?: string | null
          seo_title?: string | null
          slug: string
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          hero_media_id?: string | null
          id?: string
          name?: string
          position?: number
          published_at?: string | null
          seo_description?: string | null
          seo_title?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collections_hero_media_id_fkey"
            columns: ["hero_media_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      consultant_profiles: {
        Row: {
          audience: string | null
          availability: string | null
          bank_info: string | null
          block_reason: string | null
          created_at: string
          credit_limit_cents: number | null
          cycle: string | null
          experience: string | null
          financial_status: string | null
          goal_cents: number | null
          joined_at: string | null
          level: string | null
          origin: string | null
          party_id: string
          pix_holder: string | null
          pix_holder_doc: string | null
          pix_key: string | null
          pix_key_type: string | null
          region: string | null
          representative_party_id: string | null
          restricted_notes: string | null
          sale_profile: string | null
          sponsor_party_id: string | null
          updated_at: string
          wallet: string | null
        }
        Insert: {
          audience?: string | null
          availability?: string | null
          bank_info?: string | null
          block_reason?: string | null
          created_at?: string
          credit_limit_cents?: number | null
          cycle?: string | null
          experience?: string | null
          financial_status?: string | null
          goal_cents?: number | null
          joined_at?: string | null
          level?: string | null
          origin?: string | null
          party_id: string
          pix_holder?: string | null
          pix_holder_doc?: string | null
          pix_key?: string | null
          pix_key_type?: string | null
          region?: string | null
          representative_party_id?: string | null
          restricted_notes?: string | null
          sale_profile?: string | null
          sponsor_party_id?: string | null
          updated_at?: string
          wallet?: string | null
        }
        Update: {
          audience?: string | null
          availability?: string | null
          bank_info?: string | null
          block_reason?: string | null
          created_at?: string
          credit_limit_cents?: number | null
          cycle?: string | null
          experience?: string | null
          financial_status?: string | null
          goal_cents?: number | null
          joined_at?: string | null
          level?: string | null
          origin?: string | null
          party_id?: string
          pix_holder?: string | null
          pix_holder_doc?: string | null
          pix_key?: string | null
          pix_key_type?: string | null
          region?: string | null
          representative_party_id?: string | null
          restricted_notes?: string | null
          sale_profile?: string | null
          sponsor_party_id?: string | null
          updated_at?: string
          wallet?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consultant_profiles_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: true
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultant_profiles_representative_party_id_fkey"
            columns: ["representative_party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultant_profiles_sponsor_party_id_fkey"
            columns: ["sponsor_party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_points: {
        Row: {
          created_at: string
          id: string
          is_primary: boolean
          kind: Database["public"]["Enums"]["contact_kind"]
          label: string | null
          party_id: string
          updated_at: string
          value: string
          value_norm: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_primary?: boolean
          kind: Database["public"]["Enums"]["contact_kind"]
          label?: string | null
          party_id: string
          updated_at?: string
          value: string
          value_norm?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_primary?: boolean
          kind?: Database["public"]["Enums"]["contact_kind"]
          label?: string | null
          party_id?: string
          updated_at?: string
          value?: string
          value_norm?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_points_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_requests: {
        Row: {
          contact_channel: string
          contact_value: string
          created_at: string
          entry_url: string | null
          full_name: string
          id: string
          marketing_consent: boolean
          message: string
          privacy_version: string
          protocol: string
          source: string | null
          status: Database["public"]["Enums"]["request_status"]
          subject: string
          updated_at: string
          utm: Json
        }
        Insert: {
          contact_channel: string
          contact_value: string
          created_at?: string
          entry_url?: string | null
          full_name: string
          id?: string
          marketing_consent?: boolean
          message: string
          privacy_version: string
          protocol?: string
          source?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          subject: string
          updated_at?: string
          utm?: Json
        }
        Update: {
          contact_channel?: string
          contact_value?: string
          created_at?: string
          entry_url?: string | null
          full_name?: string
          id?: string
          marketing_consent?: boolean
          message?: string
          privacy_version?: string
          protocol?: string
          source?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          subject?: string
          updated_at?: string
          utm?: Json
        }
        Relationships: []
      }
      external_data_applications: {
        Row: {
          applied_at: string
          applied_by: string | null
          applied_fields: Json
          id: string
          identifier: string
          mapping_version: string
          party_id: string | null
          provider: string
          response_hash: string | null
        }
        Insert: {
          applied_at?: string
          applied_by?: string | null
          applied_fields?: Json
          id?: string
          identifier: string
          mapping_version?: string
          party_id?: string | null
          provider: string
          response_hash?: string | null
        }
        Update: {
          applied_at?: string
          applied_by?: string | null
          applied_fields?: Json
          id?: string
          identifier?: string
          mapping_version?: string
          party_id?: string | null
          provider?: string
          response_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "external_data_applications_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      ibge_municipios: {
        Row: {
          codigo_ibge: string
          nome: string
          nome_norm: string | null
          synced_at: string
          uf: string
        }
        Insert: {
          codigo_ibge: string
          nome: string
          nome_norm?: string | null
          synced_at?: string
          uf: string
        }
        Update: {
          codigo_ibge?: string
          nome?: string
          nome_norm?: string | null
          synced_at?: string
          uf?: string
        }
        Relationships: []
      }
      import_jobs: {
        Row: {
          created_at: string
          created_by: string | null
          defaults: Json
          dry_run: boolean
          error_rows: number
          file_name: string
          file_size: number | null
          finished_at: string | null
          id: string
          job_key: string
          last_error: string | null
          location_id: string | null
          mapping: Json
          mode: string
          ok_rows: number
          operation_date: string | null
          processed_rows: number
          products_created: number
          products_updated: number
          reason_code: string | null
          reference: string | null
          responsible_user_id: string | null
          started_at: string | null
          status: string
          stock_entries: number
          total_rows: number
          units_in: number
          updated_at: string
          variants_created: number
          variants_updated: number
          warn_rows: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          defaults?: Json
          dry_run?: boolean
          error_rows?: number
          file_name: string
          file_size?: number | null
          finished_at?: string | null
          id?: string
          job_key: string
          last_error?: string | null
          location_id?: string | null
          mapping?: Json
          mode?: string
          ok_rows?: number
          operation_date?: string | null
          processed_rows?: number
          products_created?: number
          products_updated?: number
          reason_code?: string | null
          reference?: string | null
          responsible_user_id?: string | null
          started_at?: string | null
          status?: string
          stock_entries?: number
          total_rows?: number
          units_in?: number
          updated_at?: string
          variants_created?: number
          variants_updated?: number
          warn_rows?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          defaults?: Json
          dry_run?: boolean
          error_rows?: number
          file_name?: string
          file_size?: number | null
          finished_at?: string | null
          id?: string
          job_key?: string
          last_error?: string | null
          location_id?: string | null
          mapping?: Json
          mode?: string
          ok_rows?: number
          operation_date?: string | null
          processed_rows?: number
          products_created?: number
          products_updated?: number
          reason_code?: string | null
          reference?: string | null
          responsible_user_id?: string | null
          started_at?: string | null
          status?: string
          stock_entries?: number
          total_rows?: number
          units_in?: number
          updated_at?: string
          variants_created?: number
          variants_updated?: number
          warn_rows?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_jobs_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      import_rows: {
        Row: {
          attempts: number
          created_at: string
          id: string
          job_id: string
          line_no: number
          messages: Json
          movement_id: string | null
          parsed: Json | null
          processed_at: string | null
          product_id: string | null
          raw: Json
          status: string
          variant_id: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          job_id: string
          line_no: number
          messages?: Json
          movement_id?: string | null
          parsed?: Json | null
          processed_at?: string | null
          product_id?: string | null
          raw: Json
          status?: string
          variant_id?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          job_id?: string
          line_no?: number
          messages?: Json
          movement_id?: string | null
          parsed?: Json | null
          processed_at?: string | null
          product_id?: string | null
          raw?: Json
          status?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_rows_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_rows_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_rows_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      import_templates: {
        Row: {
          created_at: string
          created_by: string | null
          defaults: Json
          id: string
          mapping: Json
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          defaults?: Json
          id?: string
          mapping?: Json
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          defaults?: Json
          id?: string
          mapping?: Json
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      integration_cache: {
        Row: {
          chave: string
          expires_at: string
          fetched_at: string
          payload: Json
          provider: string
          response_hash: string | null
        }
        Insert: {
          chave: string
          expires_at: string
          fetched_at?: string
          payload: Json
          provider: string
          response_hash?: string | null
        }
        Update: {
          chave?: string
          expires_at?: string
          fetched_at?: string
          payload?: Json
          provider?: string
          response_hash?: string | null
        }
        Relationships: []
      }
      integration_lookups: {
        Row: {
          cache_hit: boolean
          created_at: string
          error_code: string | null
          http_status: number | null
          id: string
          kind: string
          latency_ms: number | null
          provider: string
          referencia: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          cache_hit?: boolean
          created_at?: string
          error_code?: string | null
          http_status?: number | null
          id?: string
          kind: string
          latency_ms?: number | null
          provider: string
          referencia?: string | null
          status: string
          user_id?: string | null
        }
        Update: {
          cache_hit?: boolean
          created_at?: string
          error_code?: string | null
          http_status?: number | null
          id?: string
          kind?: string
          latency_ms?: number | null
          provider?: string
          referencia?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      lead_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          id: string
          lead_id: string
          note: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          lead_id: string
          note?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          lead_id?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          assigned_to: string | null
          audience: string | null
          availability: string | null
          city: string
          created_at: string
          entry_url: string | null
          experience: string | null
          financial_goal: string | null
          full_name: string
          id: string
          marketing_consent: boolean
          motivation: string | null
          no_number: boolean
          party_id: string | null
          postal_code: string | null
          privacy_version: string
          protocol: string
          source: string | null
          status: Database["public"]["Enums"]["lead_status"]
          street: string | null
          street_number: string | null
          uf: string
          updated_at: string
          utm: Json
          whatsapp: string
        }
        Insert: {
          assigned_to?: string | null
          audience?: string | null
          availability?: string | null
          city: string
          created_at?: string
          entry_url?: string | null
          experience?: string | null
          financial_goal?: string | null
          full_name: string
          id?: string
          marketing_consent?: boolean
          motivation?: string | null
          no_number?: boolean
          party_id?: string | null
          postal_code?: string | null
          privacy_version: string
          protocol?: string
          source?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          street?: string | null
          street_number?: string | null
          uf: string
          updated_at?: string
          utm?: Json
          whatsapp: string
        }
        Update: {
          assigned_to?: string | null
          audience?: string | null
          availability?: string | null
          city?: string
          created_at?: string
          entry_url?: string | null
          experience?: string | null
          financial_goal?: string | null
          full_name?: string
          id?: string
          marketing_consent?: boolean
          motivation?: string | null
          no_number?: boolean
          party_id?: string | null
          postal_code?: string | null
          privacy_version?: string
          protocol?: string
          source?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          street?: string | null
          street_number?: string | null
          uf?: string
          updated_at?: string
          utm?: Json
          whatsapp?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          address: string | null
          business_entity_id: string | null
          city: string | null
          code: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["location_type"]
          name: string
          notes: string | null
          responsible_user_id: string | null
          uf: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          business_entity_id?: string | null
          city?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["location_type"]
          name: string
          notes?: string | null
          responsible_user_id?: string | null
          uf?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          business_entity_id?: string | null
          city?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["location_type"]
          name?: string
          notes?: string | null
          responsible_user_id?: string | null
          uf?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_business_entity_id_fkey"
            columns: ["business_entity_id"]
            isOneToOne: false
            referencedRelation: "business_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      media_assets: {
        Row: {
          alt: string
          byte_size: number | null
          content_type: string | null
          created_at: string
          created_by: string | null
          height: number | null
          id: string
          is_archived: boolean
          storage_path: string | null
          updated_at: string
          url: string
          width: number | null
        }
        Insert: {
          alt?: string
          byte_size?: number | null
          content_type?: string | null
          created_at?: string
          created_by?: string | null
          height?: number | null
          id?: string
          is_archived?: boolean
          storage_path?: string | null
          updated_at?: string
          url: string
          width?: number | null
        }
        Update: {
          alt?: string
          byte_size?: number | null
          content_type?: string | null
          created_at?: string
          created_by?: string | null
          height?: number | null
          id?: string
          is_archived?: boolean
          storage_path?: string | null
          updated_at?: string
          url?: string
          width?: number | null
        }
        Relationships: []
      }
      page_versions: {
        Row: {
          blocks: Json
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          page_id: string
          title: string
          version: number
        }
        Insert: {
          blocks?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          page_id: string
          title: string
          version: number
        }
        Update: {
          blocks?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          page_id?: string
          title?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "page_versions_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
      }
      pages: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          published_at: string | null
          published_version: number | null
          seo_description: string | null
          seo_title: string | null
          slug: string
          status: Database["public"]["Enums"]["content_status"]
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          published_at?: string | null
          published_version?: number | null
          seo_description?: string | null
          seo_title?: string | null
          slug: string
          status?: Database["public"]["Enums"]["content_status"]
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          published_at?: string | null
          published_version?: number | null
          seo_description?: string | null
          seo_title?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["content_status"]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      parties: {
        Row: {
          avatar_url: string | null
          birth_date: string | null
          code: string
          created_at: string
          created_by: string | null
          display_name: string | null
          doc: string | null
          doc_canon: string | null
          doc_checked_at: string | null
          doc_digits: string | null
          doc_masked: string | null
          doc_source: string | null
          doc_verified_at: string | null
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["party_kind"]
          legal_name: string | null
          marital_status: string | null
          notes: string | null
          profession: string | null
          rg: string | null
          rg_issuer: string | null
          social_name: string | null
          status: Database["public"]["Enums"]["party_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          avatar_url?: string | null
          birth_date?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          display_name?: string | null
          doc?: string | null
          doc_canon?: string | null
          doc_checked_at?: string | null
          doc_digits?: string | null
          doc_masked?: string | null
          doc_source?: string | null
          doc_verified_at?: string | null
          id?: string
          is_active?: boolean
          kind: Database["public"]["Enums"]["party_kind"]
          legal_name?: string | null
          marital_status?: string | null
          notes?: string | null
          profession?: string | null
          rg?: string | null
          rg_issuer?: string | null
          social_name?: string | null
          status?: Database["public"]["Enums"]["party_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          avatar_url?: string | null
          birth_date?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          display_name?: string | null
          doc?: string | null
          doc_canon?: string | null
          doc_checked_at?: string | null
          doc_digits?: string | null
          doc_masked?: string | null
          doc_source?: string | null
          doc_verified_at?: string | null
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["party_kind"]
          legal_name?: string | null
          marital_status?: string | null
          notes?: string | null
          profession?: string | null
          rg?: string | null
          rg_issuer?: string | null
          social_name?: string | null
          status?: Database["public"]["Enums"]["party_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      party_addresses: {
        Row: {
          address_source: string | null
          city: string | null
          complement: string | null
          country: string
          created_at: string
          ddd: string | null
          district: string | null
          ibge_city_code: string | null
          id: string
          is_primary: boolean
          label: string | null
          latitude: number | null
          longitude: number | null
          no_number: boolean
          party_id: string
          postal_code: string | null
          reference: string | null
          street: string | null
          street_number: string | null
          uf: string | null
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          address_source?: string | null
          city?: string | null
          complement?: string | null
          country?: string
          created_at?: string
          ddd?: string | null
          district?: string | null
          ibge_city_code?: string | null
          id?: string
          is_primary?: boolean
          label?: string | null
          latitude?: number | null
          longitude?: number | null
          no_number?: boolean
          party_id: string
          postal_code?: string | null
          reference?: string | null
          street?: string | null
          street_number?: string | null
          uf?: string | null
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          address_source?: string | null
          city?: string | null
          complement?: string | null
          country?: string
          created_at?: string
          ddd?: string | null
          district?: string | null
          ibge_city_code?: string | null
          id?: string
          is_primary?: boolean
          label?: string | null
          latitude?: number | null
          longitude?: number | null
          no_number?: boolean
          party_id?: string
          postal_code?: string | null
          reference?: string | null
          street?: string | null
          street_number?: string | null
          uf?: string | null
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "party_addresses_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      party_links: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          party_id: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          party_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          party_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "party_links_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      party_roles: {
        Row: {
          created_at: string
          created_by: string | null
          ended_at: string | null
          id: string
          notes: string | null
          party_id: string
          role: Database["public"]["Enums"]["party_role_kind"]
          started_at: string | null
          status: Database["public"]["Enums"]["party_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          id?: string
          notes?: string | null
          party_id: string
          role: Database["public"]["Enums"]["party_role_kind"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["party_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          id?: string
          notes?: string | null
          party_id?: string
          role?: Database["public"]["Enums"]["party_role_kind"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["party_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "party_roles_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      product_media: {
        Row: {
          created_at: string
          id: string
          media_id: string
          position: number
          product_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          media_id: string
          position?: number
          product_id: string
        }
        Update: {
          created_at?: string
          id?: string
          media_id?: string
          position?: number
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_media_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_media_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          barcode: string | null
          color: string | null
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          label: string
          legacy_code: string | null
          position: number
          price_cents: number | null
          product_id: string
          size: string | null
          sku: string | null
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          color?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          label: string
          legacy_code?: string | null
          position?: number
          price_cents?: number | null
          product_id: string
          size?: string | null
          sku?: string | null
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          color?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          label?: string
          legacy_code?: string | null
          position?: number
          price_cents?: number | null
          product_id?: string
          size?: string | null
          sku?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          business_entity_id: string | null
          care_instructions: string | null
          category_id: string | null
          collection_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_featured: boolean
          is_new_arrival: boolean
          legacy_code: string | null
          material: string | null
          measurements: string | null
          name: string
          plating: string | null
          position: number
          price_cents: number | null
          price_is_public: boolean
          published_at: string | null
          scheduled_publish_at: string | null
          seo_description: string | null
          seo_title: string | null
          short_description: string | null
          slug: string
          status: Database["public"]["Enums"]["content_status"]
          stock_visibility: string
          supplier_id: string | null
          tags: string[]
          updated_at: string
          warranty_text: string | null
          weight_grams: number | null
        }
        Insert: {
          business_entity_id?: string | null
          care_instructions?: string | null
          category_id?: string | null
          collection_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_featured?: boolean
          is_new_arrival?: boolean
          legacy_code?: string | null
          material?: string | null
          measurements?: string | null
          name: string
          plating?: string | null
          position?: number
          price_cents?: number | null
          price_is_public?: boolean
          published_at?: string | null
          scheduled_publish_at?: string | null
          seo_description?: string | null
          seo_title?: string | null
          short_description?: string | null
          slug: string
          status?: Database["public"]["Enums"]["content_status"]
          stock_visibility?: string
          supplier_id?: string | null
          tags?: string[]
          updated_at?: string
          warranty_text?: string | null
          weight_grams?: number | null
        }
        Update: {
          business_entity_id?: string | null
          care_instructions?: string | null
          category_id?: string | null
          collection_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_featured?: boolean
          is_new_arrival?: boolean
          legacy_code?: string | null
          material?: string | null
          measurements?: string | null
          name?: string
          plating?: string | null
          position?: number
          price_cents?: number | null
          price_is_public?: boolean
          published_at?: string | null
          scheduled_publish_at?: string | null
          seo_description?: string | null
          seo_title?: string | null
          short_description?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["content_status"]
          stock_visibility?: string
          supplier_id?: string | null
          tags?: string[]
          updated_at?: string
          warranty_text?: string | null
          weight_grams?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_business_entity_id_fkey"
            columns: ["business_entity_id"]
            isOneToOne: false
            referencedRelation: "business_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string | null
          full_name: string | null
          id: string
          is_active: boolean
          job_title: string | null
          party_id: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean
          job_title?: string | null
          party_id?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean
          job_title?: string | null
          party_id?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      public_price_list: {
        Row: {
          id: string
          price_cents: number
          product_id: string
          variant_id: string | null
        }
        Insert: {
          id?: string
          price_cents: number
          product_id: string
          variant_id?: string | null
        }
        Update: {
          id?: string
          price_cents?: number
          product_id?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "public_price_list_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "public_price_list_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      role_capabilities: {
        Row: {
          capability: string
          created_at: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          capability: string
          created_at?: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          capability?: string
          created_at?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: []
      }
      showcase_batches: {
        Row: {
          action: string
          actor_id: string | null
          affected: number
          created_at: string
          filters: Json
          id: string
          idempotency_key: string
          note: string | null
          params: Json
          rejected: number
          rejected_items: Json
        }
        Insert: {
          action: string
          actor_id?: string | null
          affected?: number
          created_at?: string
          filters?: Json
          id?: string
          idempotency_key: string
          note?: string | null
          params?: Json
          rejected?: number
          rejected_items?: Json
        }
        Update: {
          action?: string
          actor_id?: string | null
          affected?: number
          created_at?: string
          filters?: Json
          id?: string
          idempotency_key?: string
          note?: string | null
          params?: Json
          rejected?: number
          rejected_items?: Json
        }
        Relationships: []
      }
      showcase_views: {
        Row: {
          created_at: string
          created_by: string | null
          filters: Json
          id: string
          is_shared: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          filters?: Json
          id?: string
          is_shared?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          filters?: Json
          id?: string
          is_shared?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      site_settings: {
        Row: {
          is_public: boolean
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          is_public?: boolean
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          is_public?: boolean
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      stock_balances: {
        Row: {
          created_at: string
          id: string
          location_id: string
          quantity: number
          reserved: number
          updated_at: string
          variant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          location_id: string
          quantity?: number
          reserved?: number
          updated_at?: string
          variant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          location_id?: string
          quantity?: number
          reserved?: number
          updated_at?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_balances_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          balance_after: number | null
          created_at: string
          created_by: string | null
          from_location_id: string | null
          id: string
          idempotency_key: string | null
          kind: Database["public"]["Enums"]["stock_move_kind"]
          note: string | null
          quantity: number
          reason_code: string | null
          reference: string | null
          to_location_id: string | null
          unit_cost_cents: number | null
          variant_id: string
        }
        Insert: {
          balance_after?: number | null
          created_at?: string
          created_by?: string | null
          from_location_id?: string | null
          id?: string
          idempotency_key?: string | null
          kind: Database["public"]["Enums"]["stock_move_kind"]
          note?: string | null
          quantity: number
          reason_code?: string | null
          reference?: string | null
          to_location_id?: string | null
          unit_cost_cents?: number | null
          variant_id: string
        }
        Update: {
          balance_after?: number | null
          created_at?: string
          created_by?: string | null
          from_location_id?: string | null
          id?: string
          idempotency_key?: string | null
          kind?: Database["public"]["Enums"]["stock_move_kind"]
          note?: string | null
          quantity?: number
          reason_code?: string | null
          reference?: string | null
          to_location_id?: string | null
          unit_cost_cents?: number | null
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_reasons: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["stock_move_kind"]
          label: string
          requires_adjust: boolean
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          kind: Database["public"]["Enums"]["stock_move_kind"]
          label: string
          requires_adjust?: boolean
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["stock_move_kind"]
          label?: string
          requires_adjust?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          city: string | null
          contact_name: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          party_id: string | null
          phone: string | null
          tax_id: string | null
          trade_name: string | null
          uf: string | null
          updated_at: string
        }
        Insert: {
          city?: string | null
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          party_id?: string | null
          phone?: string | null
          tax_id?: string | null
          trade_name?: string | null
          uf?: string | null
          updated_at?: string
        }
        Update: {
          city?: string | null
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          party_id?: string | null
          phone?: string | null
          tax_id?: string | null
          trade_name?: string | null
          uf?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          granted_by: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      variant_costs: {
        Row: {
          cost_cents: number
          created_at: string
          created_by: string | null
          currency: string
          effective_from: string
          id: string
          note: string | null
          supplier_id: string | null
          updated_at: string
          variant_id: string
        }
        Insert: {
          cost_cents: number
          created_at?: string
          created_by?: string | null
          currency?: string
          effective_from?: string
          id?: string
          note?: string | null
          supplier_id?: string | null
          updated_at?: string
          variant_id: string
        }
        Update: {
          cost_cents?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          effective_from?: string
          id?: string
          note?: string | null
          supplier_id?: string | null
          updated_at?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "variant_costs_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_costs_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_stock_delta: {
        Args: { _delta: number; _location: string; _variant: string }
        Returns: number
      }
      can_manage_catalog: { Args: { _user_id: string }; Returns: boolean }
      can_manage_content: { Args: { _user_id: string }; Returns: boolean }
      can_manage_leads: { Args: { _user_id: string }; Returns: boolean }
      can_view_costs: { Args: { _user_id: string }; Returns: boolean }
      claim_master_role: { Args: never; Returns: boolean }
      cnpj_is_valid: { Args: { c: string }; Returns: boolean }
      convert_lead_to_consultant: {
        Args: { _lead_id: string; _party_id?: string }
        Returns: string
      }
      cpf_is_valid: { Args: { d: string }; Returns: boolean }
      doc_canon: { Args: { v: string }; Returns: string }
      doc_is_valid: { Args: { v: string }; Returns: boolean }
      ensure_profile: {
        Args: never
        Returns: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string | null
          full_name: string | null
          id: string
          is_active: boolean
          job_title: string | null
          party_id: string | null
          phone: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      find_party_duplicates: {
        Args: { _contact?: string; _doc?: string; _ignore?: string }
        Returns: {
          code: string
          display_name: string
          doc_masked: string
          id: string
          legal_name: string
          motivo: string
          status: Database["public"]["Enums"]["party_status"]
        }[]
      }
      gen_protocol: { Args: { prefix: string }; Returns: string }
      get_party_full: { Args: { _id: string }; Returns: Json }
      grant_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      has_capability: {
        Args: { _cap: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      import_job_cancel: { Args: { _job: string }; Returns: undefined }
      import_job_open: {
        Args: {
          _defaults: Json
          _dry_run?: boolean
          _file_name: string
          _file_size?: number
          _job_key: string
          _location_id?: string
          _mapping: Json
          _mode: string
          _operation_date?: string
          _reason_code?: string
          _reference?: string
          _responsible?: string
        }
        Returns: string
      }
      import_job_process: {
        Args: { _job: string; _limit?: number }
        Returns: Json
      }
      import_job_validate: {
        Args: { _job: string; _limit?: number }
        Returns: Json
      }
      import_products_stock:
        | { Args: { _location_id: string; _rows: Json }; Returns: Json }
        | {
            Args: {
              _job_key?: string
              _location_id: string
              _mode?: string
              _rows: Json
            }
            Returns: Json
          }
      import_rows_stage: {
        Args: { _job: string; _rows: Json }
        Returns: number
      }
      integration_health: {
        Args: never
        Returns: {
          cache_hits_24h: number
          erros_24h: number
          latencia_media_ms: number
          provider: string
          sucessos_24h: number
          total_24h: number
          ultima_ok: string
          ultimo_erro: string
          ultimo_erro_codigo: string
        }[]
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      list_parties: {
        Args: {
          _kind?: string
          _limit?: number
          _offset?: number
          _role?: string
          _search?: string
          _status?: string
        }
        Returns: {
          birth_date: string
          code: string
          created_at: string
          display_name: string
          doc: string
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["party_kind"]
          legal_name: string
          social_name: string
          status: Database["public"]["Enums"]["party_status"]
          total: number
          updated_at: string
        }[]
      }
      mask_doc: { Args: { _doc: string }; Returns: string }
      master_exists: { Args: never; Returns: boolean }
      my_capabilities: {
        Args: never
        Returns: {
          capability: string
        }[]
      }
      my_roles: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"][]
      }
      norm_code: { Args: { _v: string }; Returns: string }
      only_digits: { Args: { _v: string }; Returns: string }
      parse_cents_any: { Args: { _v: string }; Returns: number }
      parse_decimal_any: { Args: { _v: string }; Returns: number }
      phone_canon: { Args: { v: string }; Returns: string }
      public_catalog_browse: {
        Args: {
          _category_slug?: string
          _collection_slug?: string
          _featured?: boolean
          _in_stock?: boolean
          _limit?: number
          _material?: string
          _new_arrival?: boolean
          _offset?: number
          _plating?: string
          _price_max?: number
          _price_min?: number
          _search?: string
          _sort?: string
        }
        Returns: {
          category_name: string
          category_slug: string
          collection_name: string
          collection_slug: string
          cover_alt: string
          cover_media_id: string
          em_estoque: boolean
          hover_media_id: string
          id: string
          is_featured: boolean
          is_new_arrival: boolean
          material: string
          name: string
          plating: string
          price_cents: number
          short_description: string
          slug: string
          total: number
        }[]
      }
      public_catalog_list: {
        Args: {
          _category_slug?: string
          _collection_slug?: string
          _featured?: boolean
          _limit?: number
          _offset?: number
          _search?: string
        }
        Returns: {
          category_name: string
          category_slug: string
          collection_slug: string
          cover_alt: string
          cover_media_id: string
          id: string
          is_featured: boolean
          name: string
          price_cents: number
          short_description: string
          slug: string
          total: number
        }[]
      }
      public_categories: {
        Args: never
        Returns: {
          description: string
          id: string
          name: string
          ordem: number
          produtos: number
          slug: string
        }[]
      }
      public_category: { Args: { _slug: string }; Returns: Json }
      public_product: { Args: { _slug: string }; Returns: Json }
      register_stock_movement:
        | {
            Args: {
              _from_location_id?: string
              _kind: Database["public"]["Enums"]["stock_move_kind"]
              _note?: string
              _quantity: number
              _reason_code?: string
              _reference?: string
              _to_location_id?: string
              _unit_cost_cents?: number
              _variant_id: string
            }
            Returns: string
          }
        | {
            Args: {
              _from_location_id?: string
              _idempotency_key?: string
              _kind: Database["public"]["Enums"]["stock_move_kind"]
              _note?: string
              _quantity: number
              _reason_code?: string
              _reference?: string
              _to_location_id?: string
              _unit_cost_cents?: number
              _variant_id: string
            }
            Returns: string
          }
      registry_counts: { Args: never; Returns: Json }
      registry_duplicates: {
        Args: { _limit?: number }
        Returns: {
          chave: string
          ids: string[]
          motivo: string
          quantidade: number
        }[]
      }
      resync_all_public_prices: { Args: never; Returns: number }
      revoke_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      search_registry: {
        Args: { _limit?: number; _term: string }
        Returns: {
          entity_id: string
          grupo: string
          rota: string
          selo: string
          subtitulo: string
          tipo: string
          titulo: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      showcase_bulk: {
        Args: {
          _action: string
          _filters?: Json
          _idempotency_key?: string
          _ids: string[]
          _note?: string
          _params?: Json
        }
        Returns: Json
      }
      showcase_counts: { Args: never; Returns: Json }
      showcase_ids: { Args: { _f?: Json; _max?: number }; Returns: string[] }
      showcase_list: {
        Args: { _f?: Json; _limit?: number; _offset?: number; _sort?: string }
        Returns: {
          category_id: string
          category_name: string
          collection_id: string
          collection_name: string
          cover_alt: string
          cover_media_id: string
          created_at: string
          estoque: number
          faltando: string[]
          id: string
          is_featured: boolean
          is_new_arrival: boolean
          material: string
          name: string
          plating: string
          price_cents: number
          price_is_public: boolean
          scheduled_publish_at: string
          sku: string
          slug: string
          status: Database["public"]["Enums"]["content_status"]
          supplier_name: string
          tags: string[]
          total: number
          updated_at: string
        }[]
      }
      stock_overview: { Args: never; Returns: Json }
      submit_contact_request: {
        Args: {
          p_contact_channel: string
          p_contact_value: string
          p_entry_url?: string
          p_full_name: string
          p_marketing_consent?: boolean
          p_message: string
          p_privacy_version?: string
          p_source?: string
          p_subject: string
          p_utm?: Json
        }
        Returns: string
      }
      submit_lead: {
        Args: {
          p_audience?: string
          p_availability?: string
          p_city: string
          p_entry_url?: string
          p_experience?: string
          p_financial_goal?: string
          p_full_name: string
          p_marketing_consent?: boolean
          p_motivation?: string
          p_no_number?: boolean
          p_postal_code?: string
          p_privacy_version?: string
          p_source?: string
          p_street?: string
          p_street_number?: string
          p_uf: string
          p_utm?: Json
          p_whatsapp: string
        }
        Returns: string
      }
      sync_public_prices: { Args: { _product_id: string }; Returns: undefined }
    }
    Enums: {
      app_role:
        | "master"
        | "diretoria"
        | "marketing"
        | "suporte"
        | "financeiro"
        | "cobranca"
        | "estoque"
        | "montagem"
        | "qualidade"
        | "representante"
        | "consultora"
      contact_kind: "whatsapp" | "telefone" | "email"
      content_status: "rascunho" | "revisao" | "publicado" | "arquivado"
      lead_status:
        | "novo"
        | "em_analise"
        | "qualificado"
        | "aprovado"
        | "recusado"
        | "arquivado"
      location_type: "deposito" | "loja" | "maleta" | "transito" | "outro"
      party_kind: "pessoa" | "organizacao"
      party_role_kind:
        | "candidata"
        | "consultora"
        | "revendedora"
        | "representante"
        | "colaborador"
        | "cliente"
        | "fornecedor"
        | "entidade_grupo"
        | "transportadora"
        | "prestador"
        | "custodiante"
        | "usuario"
      party_status:
        | "rascunho"
        | "em_analise"
        | "aprovado"
        | "ativo"
        | "bloqueado"
        | "inativo"
        | "desligado"
      request_status: "novo" | "em_atendimento" | "respondido" | "arquivado"
      stock_move_kind:
        | "entrada"
        | "saida"
        | "transferencia"
        | "ajuste"
        | "inventario"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "master",
        "diretoria",
        "marketing",
        "suporte",
        "financeiro",
        "cobranca",
        "estoque",
        "montagem",
        "qualidade",
        "representante",
        "consultora",
      ],
      contact_kind: ["whatsapp", "telefone", "email"],
      content_status: ["rascunho", "revisao", "publicado", "arquivado"],
      lead_status: [
        "novo",
        "em_analise",
        "qualificado",
        "aprovado",
        "recusado",
        "arquivado",
      ],
      location_type: ["deposito", "loja", "maleta", "transito", "outro"],
      party_kind: ["pessoa", "organizacao"],
      party_role_kind: [
        "candidata",
        "consultora",
        "revendedora",
        "representante",
        "colaborador",
        "cliente",
        "fornecedor",
        "entidade_grupo",
        "transportadora",
        "prestador",
        "custodiante",
        "usuario",
      ],
      party_status: [
        "rascunho",
        "em_analise",
        "aprovado",
        "ativo",
        "bloqueado",
        "inativo",
        "desligado",
      ],
      request_status: ["novo", "em_atendimento", "respondido", "arquivado"],
      stock_move_kind: [
        "entrada",
        "saida",
        "transferencia",
        "ajuste",
        "inventario",
      ],
    },
  },
} as const
