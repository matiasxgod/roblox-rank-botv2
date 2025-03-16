const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");
const express = require("express"); // UptimeRobot için küçük web sunucusu
require("dotenv").config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const ROBLOX_GROUP_ID = process.env.ROBLOX_GROUP_ID;
const ROBLOX_COOKIE = process.env.ROBLOX_COOKIE;
const PREFIX = "tca!";

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

//  CSRF Token Al
async function getCsrfToken() {
    try {
        const authResponse = await axios.get(
            "https://users.roblox.com/v1/users/authenticated",
            {
                headers: { Cookie: `.ROBLOSECURITY=${ROBLOX_COOKIE}` },
            },
        );

        if (!authResponse.data.id) {
            console.error(
                "ROBLOX_COOKIE geçersiz! Lütfen yeni bir çerez alın.",
            );
            return null;
        }

        console.log("ROBLOX_COOKIE doğrulandı, CSRF Token alınıyor...");

        try {
            await axios.post(
                "https://auth.roblox.com/v2/logout",
                {},
                {
                    headers: { Cookie: `.ROBLOSECURITY=${ROBLOX_COOKIE}` },
                },
            );
        } catch (error) {
            if (error.response && error.response.headers["x-csrf-token"]) {
                return error.response.headers["x-csrf-token"];
            }
        }

        console.error("CSRF Token alınamadı.");
        return null;
    } catch (error) {
        console.error(`CSRF Token alma işlemi başarısız: ${error.message}`);
        return null;
    }
}

// rank id veya isim bulma
async function getRoleByInput(input) {
    try {
        const response = await axios.get(
            `https://groups.roblox.com/v1/groups/${ROBLOX_GROUP_ID}/roles`,
        );
        const roles = response.data.roles;

        // --
        if (!isNaN(input)) {
            return roles.find((r) => r.rank === parseInt(input)) || null;
        }

        // --
        const role = roles.find(
            (r) => r.name.toLowerCase() === input.toLowerCase(),
        );
        return role || null;
    } catch (error) {
        console.error(`Rank bilgisi alınamadı: ${error.message}`);
        return null;
    }
}

// Kullanıcı Adını IDye çevir
async function getUserIdFromUsername(username) {
    try {
        const response = await axios.post(
            "https://users.roblox.com/v1/usernames/users",
            {
                usernames: [username],
                excludeBannedUsers: true,
            },
        );

        return response.data.data.length > 0 ? response.data.data[0].id : null;
    } catch (error) {
        console.error(`Kullanıcı ID alınamadı: ${error.message}`);
        return null;
    }
}

// Rank Değiştir
async function changeRank(userId, rankInput, message) {
    const csrfToken = await getCsrfToken();
    if (!csrfToken) {
        message.reply("CSRF Token alınamadı, işlem durduruldu.");
        return false;
    }
    const newRole = await getRoleByInput(rankInput);
    if (!newRole) {
        message.reply(`**${rankInput}** için geçerli bir rütbe bulunamadı.`);
        return false;
    } // Rank ID veya isimle Role ID bul

    let currentRole = null;
    let username = "Bilinmiyor"; // Kullanıcı adı varsayılan

    try {
        const userInfo = await axios.get(
            `https://users.roblox.com/v1/users/${userId}`,
        ); // Kullanıcının adını alan API
        if (userInfo.data && userInfo.data.name) {
            username = userInfo.data.name; // Roblox Kullanıcı Adı
        }
    } catch (error) {
        console.error(`Kullanıcı adı alınamadı: ${error.message}`);
    }

    try {
        // Kullanıcının mevcut grubundaki rolünü almak için API isteği
        const userResponse = await axios.get(
            `https://groups.roblox.com/v2/users/${userId}/groups/roles`,
        );
        if (userResponse.data && userResponse.data.data) {
            const userGroup = userResponse.data.data.find(
                (g) => g.group.id === parseInt(ROBLOX_GROUP_ID),
            );
            if (userGroup) {
                currentRole = userGroup.role.rank; // mevcut rank
            }
        }
    } catch (error) {
        console.error(
            `Kullanıcının mevcut rütbesi alınamadı: ${error.message}`,
        );
    }

    try {
        const response = await axios.patch(
            `https://groups.roblox.com/v1/groups/${ROBLOX_GROUP_ID}/users/${userId}`,
            { roleId: newRole.id },
            {
                headers: {
                    "X-CSRF-TOKEN": csrfToken,
                    Cookie: `.ROBLOSECURITY=${ROBLOX_COOKIE}`,
                    "Content-Type": "application/json",
                },
            },
        );

        if (response.status === 200) {
            let statusMessage = "";

            if (currentRole !== null) {
                if (currentRole < newRole.rank) {
                    statusMessage = `Kullanıcı **${username}** başarıyla, **${newRole.name}** rütbesine terfi edildi!`;
                } else if (currentRole > newRole.rank) {
                    statusMessage = `Kullanıcı **${username}** başarıyla, **${newRole.name}** rütbesine tenzil edildi!`;
                } else {
                    statusMessage = `Kullanıcının rütbesi değişmedi. **Zaten aynı rütbede.**`;
                }
            } else {
                statusMessage = `Kullanıcı **${username}** başarıyla, **${newRole.name}** rütbesine atandı.`;
            }

            console.log(statusMessage);
            message.reply(statusMessage);
            return true;
        } else {
            console.error(
                `Rank değiştirme başarısız. Status: ${response.status}, Response: ${JSON.stringify(response.data)}`,
            );
            message.reply("Rank değiştirme işlemi başarısız oldu.");
            return false;
        }
    } catch (error) {
        console.error(
            `Hata Kodu: ${error.response?.status || "Bilinmiyor"}, Response: ${JSON.stringify(error.response?.data || error.message)}`,
        );
        message.reply("Bir hata oluştu, işlem başarısız.");
        return false;
    }
}

const ALLOWED_ROLES = ["Rank Verme"]; // İzin verilen roller

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    const args = message.content.split(" ");
    const command = args[0].toLowerCase(); // Komutu küçük harfe çevir

    // HELP / YARDIM Komutu
    if (command === `${PREFIX}help` || command === `${PREFIX}yardım`) {
        return message.reply(
            "**Bot Komutları;**\n\n" +
                "`tca!rütbe <Kullanıcı_Adı> veya <Kullanıcı_ID> <Rank ID>  veya <Rank İsmi>` - Kullanıcının rütbesini değiştirir.\n" +
                "**Örnekler:**\n" +
                "`tca!rütbe TestPlayer 255` - Kullanıcıyı Rank ID ile rütbe değiştir.\n" +
                "`tca!rütbe TestPlayer Admin` - Kullanıcıyı Rank ismiyle rütbe değiştir.\n\n" +
                "**Not:** Sadece yetkililer bu komutları kullanabilir.",
        );
    }

    // Rank Değiştirme Komutu
    if (!message.content.startsWith(`${PREFIX}rütbe`)) return;

    const hasPermission = message.member.roles.cache.some((role) =>
        ALLOWED_ROLES.includes(role.name),
    );
    if (!hasPermission) {
        return message.reply(
            "Bu komutu kullanma yetkiniz yok. Sadece yetkililer kullanabilir.",
        );
    }

    if (args.length < 3) {
        return message.reply(
            "Hatalı kullanım.\n" +
                "Doğru Kullanım: `tca!rütbe <Kullanıcı_Adı> veya <Kullanıcı_ID> <Rank ID  veya Rank İsmi>`\n" +
                "**Örnekler:**\n" +
                "`tca!rütbe TestPlayer 255`   - Rank ID ile rütbe değiştir.\n" +
                "`tca!rütbe TestPlayer Admin` - Rank ismiyle rütbe değiştir..",
        );
    }

    let userId = args[1];
    const rankInput = args.slice(2).join(" ");

    if (isNaN(userId)) {
        userId = await getUserIdFromUsername(userId);
        if (!userId) {
            return message.reply(`"${args[1]}" adlı kullanıcı bulunamadı.`);
        }
    }

    const success = await changeRank(userId, rankInput, message);
    if (!success) {
        message.reply(
            "Rütbe değiştirme işlemi başarısız oldu. Girdiğiniz bilgileri kontrol edin.",
        );
    }
});

const app = express();
app.get("/", (req, res) => res.send("Bot Çalışıyor!"));
app.listen(3000, () => console.log("UptimeRobot İçin Web Sunucusu Açıldı!")); // Webview

client.login(DISCORD_TOKEN); // Botu Başlat
