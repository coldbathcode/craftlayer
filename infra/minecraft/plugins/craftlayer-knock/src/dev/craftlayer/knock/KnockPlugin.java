package dev.craftlayer.knock;

import com.destroystokyo.paper.profile.PlayerProfile;
import io.papermc.paper.connection.PlayerLoginConnection;
import io.papermc.paper.event.connection.PlayerConnectionValidateLoginEvent;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.bukkit.OfflinePlayer;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * CraftLayer Knock: records players the allowlist turned away, so a family manager can
 * allow exactly that account later ("asking to join"). It grants nothing, changes nothing
 * about the login, and never records IP addresses. Records are one JSON object per line
 * in plugins/CraftLayerKnock/knocks.jsonl, bounded in size and rate.
 */
public final class KnockPlugin extends JavaPlugin implements Listener {
  private static final long RATE_LIMIT_MS = 60_000L;
  private static final long MAX_FILE_BYTES = 1_048_576L;
  private final Map<UUID, Long> lastRecorded = new HashMap<>();
  private Path file;

  @Override
  public void onEnable() {
    try {
      Files.createDirectories(getDataFolder().toPath());
    } catch (IOException e) {
      getLogger().warning("Cannot create data folder; knocks will not be recorded.");
      return;
    }
    file = getDataFolder().toPath().resolve("knocks.jsonl");
    getServer().getPluginManager().registerEvents(this, this);
    getLogger().info("Recording allowlist refusals to " + file.getFileName() + " (no addresses).");
  }

  /** Fires after the server validated the login (allowlist, bans, capacity). Monitor only. */
  @EventHandler(priority = EventPriority.MONITOR)
  public void onValidateLogin(PlayerConnectionValidateLoginEvent event) {
    if (event.isAllowed() || file == null) return;
    if (!(event.getConnection() instanceof PlayerLoginConnection login)) return;
    PlayerProfile profile = login.getAuthenticatedProfile();
    if (profile == null || profile.getId() == null || profile.getName() == null) return;
    UUID uuid = profile.getId();
    if (!getServer().hasWhitelist()) return;
    OfflinePlayer player = getServer().getOfflinePlayer(uuid);
    // Only an allowlist refusal is a knock; bans and a full server are not invitations.
    if (player.isWhitelisted() || player.isBanned()) return;
    long now = System.currentTimeMillis();
    synchronized (lastRecorded) {
      Long last = lastRecorded.get(uuid);
      if (last != null && now - last < RATE_LIMIT_MS) return;
      lastRecorded.put(uuid, now);
      if (lastRecorded.size() > 1000) lastRecorded.clear();
    }
    boolean bedrock = uuid.getMostSignificantBits() == 0L;
    StringBuilder line = new StringBuilder(160)
        .append("{\"v\":1,\"at\":\"").append(Instant.ofEpochMilli(now))
        .append("\",\"result\":\"KICK_WHITELIST\",\"edition\":\"").append(bedrock ? "bedrock" : "java")
        .append("\",\"name\":\"").append(escape(profile.getName()))
        .append("\",\"uuid\":\"").append(uuid);
    if (bedrock) line.append("\",\"xuid\":\"").append(Long.toUnsignedString(uuid.getLeastSignificantBits()));
    line.append("\"}\n");
    try {
      if (Files.exists(file) && Files.size(file) > MAX_FILE_BYTES) {
        Files.move(file, file.resolveSibling("knocks.previous.jsonl"), StandardCopyOption.REPLACE_EXISTING);
      }
      Files.writeString(file, line.toString(), StandardCharsets.UTF_8,
          StandardOpenOption.CREATE, StandardOpenOption.APPEND);
    } catch (IOException e) {
      getLogger().warning("Could not record a knock; values omitted.");
    }
  }

  private static String escape(String value) {
    StringBuilder out = new StringBuilder(value.length());
    for (char c : value.toCharArray()) {
      if (c == '"' || c == '\\') out.append('\\').append(c);
      else if (c < 0x20 || c == 0x7f) out.append('?');
      else out.append(c);
    }
    return out.toString();
  }
}
