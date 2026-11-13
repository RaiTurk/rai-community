// Terms of use shown before first use. Bump TERMS_VERSION whenever the text
// changes in substance: every user is asked to accept again.
export const TERMS_VERSION = '2026-11-12.2';
const KEY = 'rai.terms';

export function acceptedTerms(storage) {
  try { const v = JSON.parse(storage.getItem(KEY) || 'null'); return v?.version === TERMS_VERSION ? v : null; } catch { return null; }
}
export function acceptTerms(storage) {
  const record = { version: TERMS_VERSION, acceptedAt: new Date().toISOString() };
  storage.setItem(KEY, JSON.stringify(record));
  return record;
}

export const termsText = {
  tr: [
    ['Ne olduğu', 'Rai Community açık kaynaklı, eşler arası (peer-to-peer) bir topluluk yazılımıdır. Merkezî bir sunucusu yoktur; kayıtlar kullanıcıların cihazlarında tutulur ve paylaşılır. Uygulamayı geliştiren ve topluluğu düzenleyen kişi (RaiTurk) yalnız yazılımı ve topluluk kurallarını sağlar; kullanıcıların içeriklerini ve eylemlerini önceden denetlemez, onaylamaz ve bunlardan sorumlu değildir. Resmî bir Holochain ürünü değildir.'],
    ['Yasalara uyum senin sorumluluğunda', 'Uygulamayı kullandığın ülkenin ve bulunduğun yerin yasalarına, ayrıca kullandığın platformların (ör. X) kurallarına uymak tamamen senin sorumluluğundadır. Bulunduğun yerde bu tür bir yazılımı kullanmak, gönüllü barındırma yapmak veya içerik paylaşmak yasak ya da kısıtlıysa uygulamayı kullanma.'],
    ['Paylaşım ve davranış', 'Hukuka aykırı, hakaret, taciz, nefret, şiddet, başkasının kişisel verisi, telif hakkı ihlali veya yanıltıcı içerik paylaşmamayı kabul edersin. Görevler gönüllüdür; X’teki her eylemini kendi hesabınla, kendi kararınla ve gerçek ilginle yaparsın. Sahte hesap, otomasyon, toplu/koordineli sahte etkileşim veya X’in platform manipülasyonu ve spam kurallarına aykırı davranış yasaktır. Yönetici kurallara aykırı davranışta topluluk erişimini kaldırabilir.'],
    ['Nezaket', 'Her zaman nazik ve saygılı ol. Kimseyi bilerek incitme, aşağılama veya hakaret etme. Küfür ve kötü söz kullanma. Bu kural mesajlar dahil topluluğun her yerinde geçerlidir. Kuralı ihlal ettiğin bir üyelik kararıyla belirlenirse topluluktan çıkarılırsın.'],
    ['Rai Community kuralları', 'Rai Community’nin kurallarını kurucu RaiTurk belirler. Rai Community’yi kullanarak bu kuralları kabul ediyorum. Kuralların uygulanması ve üyelikle ilgili itirazlarda son kararı RaiTurk verir.'],
    ['Ayrılmak ve kendi topluluğunu kurmak', 'Bu topluluk bana uygun gelmezse ayrılabilir, erişebildiğim kendi kayıtlarımın bir kopyasını saklayabilir ve Holochain üzerinde kendi topluluğumu kurabilirim.'],
    ['Kayıtlar herkese açık ve silinemez', 'Görünen adın, mesajların, katkı bildirimlerin, bağladığın X kullanıcı adı ve diğer topluluk kayıtları ağdaki eşlerle paylaşılır ve kalıcıdır. Yönetici dahil hiç kimse bunları ağdan tamamen silemez. Gizli veya başkasına ait kişisel bilgi yazma.'],
    ['RaiUnyt para değildir', 'RaiUnyt, katkıyı görünür kılan, kişiye bağlı ve devredilemeyen bir tanınma puanıdır. Parasal değeri yoktur; satılamaz, takas edilemez, ödeme, ücret, yatırım, kripto varlık veya gelecekte ödül alma sözü değildir. Kuralları değişebilir. Katkıların karşılığında hiçbir ücret, iş ilişkisi veya ödül taahhüdü yoktur.'],
    ['Cihaz ve barındırma', 'Uygulama açıkken cihazın disk, internet ve enerji kullanır. Bu maliyetler ve kullandığın ağın (iş yeri, okul, internet sağlayıcısı) kurallarına uyum sana aittir.'],
    ['Kurtarma kodu', 'Gizli kurtarma kodunu yalnız sen saklarsın. Kaybolursa veya başkası ele geçirirse hiç kimse geri getiremez.'],
    ['Garanti yoktur', 'Yazılım “olduğu gibi” sunulur; kesintisiz, hatasız veya güvenli çalışacağı garanti edilmez. Yürürlükteki hukukun izin verdiği en geniş ölçüde, geliştirici ve düzenleyici; kullanımdan, kullanıcı içeriklerinden, veri kaybından veya üçüncü kişilerin eylemlerinden doğan zararlardan sorumlu değildir. Kendi kullanımından doğan taleplerde geliştiriciyi ve düzenleyiciyi sorumlu tutmamayı kabul edersin.'],
    ['Yaş', '18 yaşından büyük (veya bulunduğun yerde reşit) olduğunu beyan edersin.'],
    ['Değişiklikler', 'Koşullar değişirse uygulama seni yeniden onaya çağırır. Onay bu cihazda tarih ve sürümle saklanır.'],
  ],
  en: [
    ['What this is', 'Rai Community is open-source, peer-to-peer community software. It has no central server; records are stored and shared on users’ devices. The developer and community organizer (RaiTurk) only provide the software and community rules; they do not pre-screen, endorse or take responsibility for users’ content or actions. It is not an official Holochain product.'],
    ['You are responsible for legal compliance', 'You are solely responsible for complying with the laws of your country and of the place where you use the app, and with the rules of platforms you use (e.g. X). If using this kind of software, volunteer hosting or posting content is prohibited or restricted where you are, do not use the app.'],
    ['Content and conduct', 'You agree not to post unlawful, defamatory, harassing, hateful or violent content, other people’s personal data, copyright-infringing or misleading content. Tasks are voluntary; every action on X is taken from your own account, by your own decision and genuine interest. Fake accounts, automation, coordinated inauthentic engagement, or anything that breaks X’s platform manipulation and spam rules is prohibited. The organizer may revoke community access for rule violations.'],
    ['Courtesy', 'Always be courteous and respectful. Never deliberately hurt, demean or insult others. Do not swear or use abusive language. This rule applies throughout the community, including messages. If a membership decision finds that you broke this rule, you will be removed from the community.'],
    ['Rai Community rules', 'RaiTurk, the founder, sets the rules for Rai Community. By using Rai Community, I accept these rules. RaiTurk has the final say on how the rules are applied and on membership appeals.'],
    ['Leaving and starting your own community', 'If this community no longer suits me, I can leave, keep a copy of my own records that I can access, and start my own community on Holochain.'],
    ['Records are public and permanent', 'Your display name, messages, contribution reports, linked X username and other community records are shared with network peers and are permanent. Nobody, including the organizer, can fully delete them from the network. Do not post secrets or other people’s personal information.'],
    ['RaiUnyt is not money', 'RaiUnyt is a personal, non-transferable recognition score. It has no monetary value; it cannot be sold or exchanged and is not a payment, wage, investment, crypto-asset or promise of a future reward. Its rules may change. Contributions create no payment, employment relationship or reward commitment.'],
    ['Device and hosting', 'While open, the app uses your device’s disk, bandwidth and energy. These costs, and compliance with the rules of the network you use (employer, school, ISP), are yours.'],
    ['Recovery code', 'Only you keep your private recovery code. If it is lost or taken, nobody can restore it.'],
    ['No warranty', 'The software is provided “as is”, without any warranty of uninterrupted, error-free or secure operation. To the fullest extent permitted by applicable law, the developer and organizer are not liable for damages arising from use, user content, data loss or third-party actions. You agree to hold the developer and organizer harmless from claims arising from your own use.'],
    ['Age', 'You confirm you are at least 18 (or of legal age where you live).'],
    ['Changes', 'If these terms change, the app asks you to accept again. Your acceptance is stored on this device with date and version.'],
  ],
};

export const termsChecks = {
  tr: [
    'Bulunduğum yerin yasalarına ve kullandığım platformların kurallarına uymaktan yalnız benim sorumlu olduğumu kabul ediyorum.',
    'Paylaştığım içerikten ve yaptığım eylemlerden yalnız ben sorumluyum; geliştiriciyi ve düzenleyiciyi sorumlu tutmayacağım.',
    'Kayıtların herkese açık ve kalıcı olduğunu, RaiUnyt’in para veya ödül sözü olmadığını anlıyorum.',
    'Her zaman nezaketi koruyacağımı ve bu kuralı ihlal edersem topluluktan çıkarılacağımı anlıyorum.',
    '18 yaşından büyüğüm (veya bulunduğum yerde reşidim) ve bu koşulları kabul ediyorum.',
  ],
  en: [
    'I accept that I alone am responsible for complying with the laws where I am and with the rules of platforms I use.',
    'I alone am responsible for what I post and do; I will not hold the developer or organizer liable.',
    'I understand records are public and permanent, and RaiUnyt is not money or a promise of reward.',
    'I agree to always be courteous and understand that I will be removed if I break this rule.',
    'I am at least 18 (or of legal age where I live) and I accept these terms.',
  ],
};
